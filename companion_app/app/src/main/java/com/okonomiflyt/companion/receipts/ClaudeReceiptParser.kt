package com.okonomiflyt.companion.receipts

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Log
import com.okonomiflyt.companion.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Parses grocery receipts (PDF or image) into structured line items by calling
 * the Claude API directly. Structured outputs (output_config.format) guarantee
 * the response conforms to the JSON schema below.
 */
class ClaudeReceiptParser {

    companion object {
        private const val TAG = "ClaudeReceiptParser"
        private const val API_URL = "https://api.anthropic.com/v1/messages"
        private const val MODEL = "claude-haiku-4-5"
        // Escalation target when the sum check keeps failing on the primary model
        private const val FALLBACK_MODEL = "claude-sonnet-4-6"
        // Receipts older than this are almost certainly a hallucinated date
        private const val MAX_AGE_DAYS = 120L
        // Line items must sum to the receipt total within this (øre rounding)
        private const val SUM_TOLERANCE = 0.05
        // The API allows at most 10 MB per image *after* base64 (+33 %), so re-encode above this
        private const val MAX_IMAGE_BYTES = 7_000_000

        // Standard-tier vision limits (Haiku 4.5 / Sonnet 4.6): before the model sees
        // an image the API downscales it to at most 1568 px on the long edge AND at
        // most 1568 visual tokens of 28x28 px. A tall receipt screenshot (1080x8000)
        // therefore ends up ~210 px wide and the digits on quantity/weight lines
        // become unreadable. Tall images are cut into strips that each fit the
        // limits at full width; the model is told they are parts of one receipt.
        private const val VISION_PATCH_PX = 28
        private const val VISION_MAX_PATCHES = 1568
        private const val VISION_MAX_EDGE_PX = 1568
        // Widest strip that still leaves 40 rows of patches (39 x 40 = 1560 tokens).
        // Wider images are shrunk to this; a phone screenshot (1080 px) is untouched.
        private const val TILE_MAX_WIDTH = 39 * VISION_PATCH_PX
        // Neighbouring strips share this many rows (about two text lines) so a line
        // cut by a strip boundary is whole in one of them
        private const val TILE_OVERLAP_PX = 96

        // Fixed category set so spending statistics stay consistent across receipts
        val CATEGORIES = listOf(
            "meieri", "frukt_gront", "kjott_fisk", "brod_bakevarer", "torrvarer",
            "frys", "drikke", "snacks_godteri", "husholdning", "personlig_pleie",
            "pant", "annet"
        )

        private const val SYSTEM_PROMPT = """Du analyserer norske dagligvarekvitteringer (mest fra Coop og Kiwi) og trekker ut alle varelinjer. Regler merket med en kjede (f.eks. Coop) beskriver den kjedens kvitteringsformat — bruk dem når kvitteringen er fra den kjeden.

Regler:
- Ta med ALLE varelinjer som bidrar til totalbeløpet, også pant.
- Underlinjer som "Antall: N stk Y kr/stk" angir antall og stykkpris for linjen RETT OVER: sett quantity=N og unitPrice=Y på den linjen. Dette gjelder også PANT-linjer.
- PAKNINGSSTØRRELSE ER IKKE ANTALL: "6PK", "2PK", "4X100G" osv. i varenavnet beskriver pakningen og skal STÅ i navnet, ikke bli quantity. En 6-pakning uten "Antall:"-linje er quantity=1 til pakkeprisen — ALDRI del pakkeprisen på enhetene i pakningen.
- Varer i ulik pakningsstørrelse eller variant er ULIKE varer med ULIKT normalizedName (f.eks. "coop iste fersken uts" (enkeltflaske) og "coop iste fersken 6pk" er to forskjellige varer). Gjenbruk bare navn fra kjente-listen når det er NØYAKTIG samme produkt OG pakningsstørrelse — ellers lag et nytt presist navn.
- Pant: egne linjer (f.eks. "PANT", "+PANT") -> isPant=true, kategori "pant". En "Antall:"-underlinje under PANT gjelder KUN pantlinjen — bruk den aldri til å regne om varelinjen over.
- REGISTRER PAKNINGEN SLIK DEN ER SOLGT: unitPrice er prisen for salgsenheten slik den står på kvitteringen, og quantity er antall LIKE salgsenheter — hentet fra varens EGEN "Antall:"-underlinje eller fra gjentatte identiske linjer. Regn ALDRI om til pris per enhet inne i en pakning: "COCA COLA UTS 10PK 56.90" er quantity=1, unitPrice=56.90, normalizedName "coca cola 0.33l 10pk" — ikke 10 x 5.69. Prisutviklingen skal følge pakningen man faktisk kjøper.
- Rabatter finnes i TO varianter — ikke bland dem:
  1) Informasjonslinje (Coop-stil): varelinjen viser allerede NETTO-pris (rabatten er trukket fra), og under står f.eks. "Rabatt: NOK 22.77 (30% av 75.90)". Da skal du IKKE lage egen rabattlinje. Sett discount-feltet på varen til rabattbeløpet (22.77) og la totalPrice være netto slik den står på varelinjen (53.13).
  2) Ekte minuslinje: varelinjen viser FULL pris, og rabatten er en egen linje med negativt beløp som inngår i summen. Da lager du en egen linje med isDiscount=true og negativ totalPrice. Kategori settes lik varen rabatten gjelder hvis det fremgår, ellers "annet".
- discount er alltid 0 for varer uten rabatt og for variant 2.
- MIX-/PAKKETILBUD (Coop): en overskriftslinje i fet (f.eks. "Medlem Farris 1,5 l 3for40" eller "Coop Kaffe 250 gr. 2for"), deretter varelinjer med beløp i PARENTES, ev. "Antall:"-underlinjer, en "Sum (X)"-linje, en "Mixrabatt (-Y)"-linje og til slutt "Sum mix Z". Slik håndteres blokken:
  * Beløp i parentes er ordinærpriser til INFORMASJON — de bidrar ikke til totalen. Det som faktisk betales for varene i blokken er KUN "Sum mix"-beløpet (Z).
  * Ikke lag linjer for overskriften, "Sum", "Mixrabatt" eller "Sum mix".
  * Fordel rabatten forholdsmessig: hver vare i blokken får totalPrice = (ordinær pris / X) * Z, og discount = ordinær pris - totalPrice. Rund av til hele øre og legg avrundingsresten på den dyreste varen, slik at blokkens varer summerer EKSAKT til Z.
  * PANT-linjer inne i blokken står UTEN parentes og bidrar til totalen som vanlige pant-linjer (de er ikke del av "Sum mix").
- Beløp i parentes andre steder på kvitteringen er også kun informasjon og skal aldri bidra til summen.
- normalizedName: små bokstaver, rekkefølgen merkevare + produkt + størrelse + ev. pakningsstørrelse, ingen bindestrek eller skråstrek (bruk mellomrom), desimaltall med punktum. Bruk FULLE, gjenkjennelige ord — utvid forkortelser fra kvitteringen: "CC" -> "coca cola", "UTS"/"U/S"/"SF" -> "uten sukker"/"sukkerfri", "BR.BÆR" -> "bringebær", "LE." -> "lettmelk" osv. Kjente merkeforkortelser hos Coop: "GRAND." -> grandiosa (pizza), "FJL" -> fjordland, "MA."/"MAAR." -> maarud, "GREV." -> grevens, "LIBE." -> libero, "NICOR." -> nicorette, "DR.GR." -> dr greve, "DR.O" -> dr oetker, "SØRL." -> sørlandschips, "TRO"/"TORO" -> toro. Ikke gjett nye merkenavn som ikke finnes — er du usikker, behold ordet slik det står. F.eks. "TINE LETTMELK 1,75% 1L" -> "tine lettmelk 1.75% 1l", "Q-MELK LETT 1.75L" -> "q melk lettmelk 1.75l". Samme vare SKAL få nøyaktig samme normalizedName på tvers av kvitteringer FRA SAMME KJEDE — sjekk kjente-varenavn-listen for kvitteringens kjede nederst og gjenbruk eksakt navn derfra hvis varen finnes der. Bruk ALDRI navn fra en annen kjedes liste — kjedene navngir samme vare forskjellig, og statistikken føres per kjede.
- Vekt-varer: unit="kg", quantity=vekten, unitPrice=kilopris. Volum: unit="l". Ellers unit="stk".
- LINJESUM: hver varelinje har en trykt linjesum ytterst til høyre. totalPrice er ALLTID den trykte linjesummen, kopiert siffer for siffer — regn den aldri ut selv fra antall × pris. Les desimalene nøyaktig (44,80 er ikke 44,90). Sjekk deretter at quantity × unitPrice ≈ totalPrice; stemmer det ikke, har du lest ett av tallene feil — les linjen på nytt.
- KIWI-APPEN (digital kvittering — ser annerledes ut enn papirkvitteringen fra kassa): øverst står et sammendrag med "Kjøpesum" (= total; tusenskille med mellomrom, "1 146,23 kr" = 1146.23), deretter bonuslinjer som "Grunnbonus + 1%", "Trumf Pay +1%", "Trumf Kredittkort +1%", "KIWI PLUSS Frukt & Grønt + 14%" og "Total Trumf-bonus". Dette er Trumf-BONUS kunden får i etterkant — IKKE rabatt og IKKE varelinjer; de skal aldri trekkes fra, legges til eller tas med som linjer. Under "Varer" står hver vare som: navn, beløp til høyre, en underlinje med antall ("2 stk") eller vekt ("430 gram"), og et prosentmerke ("3 %", "17 %") som er bonusprosent — ignorer prosentmerket helt (discount=0). Beløpet til høyre er LINJESUMMEN for hele antallet: "Lettmelk 1% 1,75l q  94,20 kr / 3 stk" -> quantity=3, unitPrice=31.40, totalPrice=94.20. Vekt: "Løk gul pr kg first price  14,15 kr / 430 gram" -> unit="kg", quantity=0.43, unitPrice=32.91 (linjesum delt på kg, to desimaler), totalPrice=14.15. Pant står som egne varelinjer. Kjøpstidspunktet står under butikknavnet, ofte relativt ("I dag kl. 13:30", "I går ...").
- KONTROLL: summen av alle totalPrice (inkl. pant og ev. negative rabattlinjer) skal være eksakt lik totalbeløpet. Stemmer det ikke, har du sannsynligvis dobbelttellet en rabatt av variant 1 — rett det opp før du svarer.
- date er kjøpsdato i formatet YYYY-MM-DD, lest fra kvitteringen. Står datoen relativt («i dag», «i går»), regn den ut fra dagens dato som oppgis under. Finner du ingen dato, bruk dagens dato — GJETT ALDRI en dato. total er beløpet som faktisk ble betalt."""
    }

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(180, TimeUnit.SECONDS)
        .build()

    /**
     * Parses with self-correction: the receipt total is a checksum we can
     * verify against, so on mismatch the model is told the difference and
     * asked to fix its own parse. If it still doesn't add up, one final
     * attempt runs on a stronger model. Returns the attempt with the
     * smallest deviation (the UI warns if any deviation remains).
     *
     * @param fileBytes raw bytes of the shared receipt
     * @param mimeHint mime type from the sharing app — used only as fallback,
     *   the real type is sniffed from the file bytes since sharing apps often
     *   report application/octet-stream
     * @param knownNames previously used normalizedNames per chain family
     *   (see [chainGroup]) — given to the model so the same product gets the
     *   same name across receipts, without mixing names between chains
     * @param lessons persistent user corrections, injected into every parse
     * @param feedback a user comment on the previous parse of this receipt —
     *   triggers a refinement turn instead of a fresh parse
     * @param previousRaw the raw JSON the feedback refers to
     */
    suspend fun parse(
        fileBytes: ByteArray,
        mimeHint: String?,
        knownNames: Map<String, List<String>> = emptyMap(),
        lessons: List<String> = emptyList(),
        feedback: String? = null,
        previousRaw: String? = null
    ): Result<ParsedReceipt> =
        withContext(Dispatchers.IO) {
            try {
                if (BuildConfig.ANTHROPIC_API_KEY.isEmpty()) {
                    return@withContext Result.failure(
                        IllegalStateException("ANTHROPIC_API_KEY mangler i local.properties")
                    )
                }

                val detectedMime = detectMime(fileBytes, mimeHint)
                    ?: return@withContext Result.failure(
                        RuntimeException(
                            "Ukjent filtype (ikke PDF eller bilde). Mottatt mime: $mimeHint"
                        )
                    )
                val receiptBlocks = receiptBlocks(fileBytes, detectedMime)
                val stripCount = receiptBlocks.count { it.optString("type") == "image" }
                val parseInstruction = buildString {
                    append("Analyser denne kvitteringen og trekk ut alle varelinjer.")
                    if (stripCount > 1) {
                        append(
                            " Kvitteringen er ett langt bilde delt i $stripCount utsnitt ovenfra og ned. " +
                                "Naboutsnitt overlapper litt: en varelinje som er synlig nederst i ett utsnitt " +
                                "og øverst i det neste er SAMME linje og skal bare telles én gang."
                        )
                    }
                }

                val today = isoDate(java.util.Date())
                val systemPrompt = buildString {
                    append(SYSTEM_PROMPT)
                    append("\n\nDagens dato er ").append(today).append('.')
                    if (lessons.isNotEmpty()) {
                        append("\n\nVARIGE RETTELSER FRA BRUKEREN (følg disse, de overstyrer andre regler ved konflikt):\n")
                        lessons.take(100).forEach { append("- ").append(it).append('\n') }
                    }
                    if (knownNames.values.any { it.isNotEmpty() }) {
                        append("\nKjente varenavn per kjede. Gjenbruk eksakt navn fra listen for kvitteringens kjede når varen er den samme — bruk aldri navn fra en annen kjedes liste:\n")
                        knownNames.forEach { (chain, names) ->
                            if (names.isEmpty()) return@forEach
                            append("\n[").append(chain).append("]\n")
                            names.take(600).forEach { append(it).append('\n') }
                        }
                    }
                }

                val messages = JSONArray().put(userMessage(receiptBlocks, parseInstruction))
                if (feedback != null && previousRaw != null) {
                    messages.put(JSONObject().apply {
                        put("role", "assistant")
                        put("content", previousRaw)
                    })
                    messages.put(userMessage(
                        emptyList(),
                        "Brukeren har sett gjennom analysen din og kommenterer: «$feedback». " +
                            "Rett opp i henhold til kommentaren og lever HELE varelisten på nytt."
                    ))
                }

                // Attempt 1: primary model
                val (first, firstRaw) = requestParse(MODEL, systemPrompt, messages)
                var best = first.copy(parseAttempts = 1, parseModel = MODEL, rawJson = firstRaw)
                if (sumDeviation(best) <= SUM_TOLERANCE) return@withContext Result.success(withSaneDate(best))

                // Attempt 2: same model, told exactly how far off it was
                Log.w(TAG, "Sum check failed (${sumDeviation(best)}), asking model to self-correct")
                messages.put(JSONObject().apply {
                    put("role", "assistant")
                    put("content", firstRaw)
                })
                messages.put(userMessage(emptyList(), correctionText(best)))
                runCatching { requestParse(MODEL, systemPrompt, messages) }
                    .onSuccess { (second, secondRaw) ->
                        if (sumDeviation(second) < sumDeviation(best)) {
                            best = second.copy(parseAttempts = 2, parseModel = MODEL, rawJson = secondRaw)
                        }
                    }
                if (sumDeviation(best) <= SUM_TOLERANCE) return@withContext Result.success(withSaneDate(best))

                // Attempt 3: stronger model, fresh conversation
                Log.w(TAG, "Still off (${sumDeviation(best)}), escalating to $FALLBACK_MODEL")
                val freshMessages = JSONArray().put(userMessage(receiptBlocks, parseInstruction))
                runCatching { requestParse(FALLBACK_MODEL, systemPrompt, freshMessages) }
                    .onSuccess { (third, thirdRaw) ->
                        if (sumDeviation(third) < sumDeviation(best)) {
                            best = third.copy(parseAttempts = 3, parseModel = FALLBACK_MODEL, rawJson = thirdRaw)
                        }
                    }

                Result.success(withSaneDate(best))
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse receipt", e)
                Result.failure(e)
            }
        }

    /** Receipt blocks (document, or labelled image strips) first, then the instruction. */
    private fun userMessage(receiptBlocks: List<JSONObject>, text: String): JSONObject {
        val content = JSONArray()
        receiptBlocks.forEach { content.put(it) }
        content.put(JSONObject().put("type", "text").put("text", text))
        return JSONObject().put("role", "user").put("content", content)
    }

    private fun isoDate(d: java.util.Date): String =
        java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(d)

    /**
     * The model has been seen inventing dates (2024-01-01, 2025-01-01 …) when
     * a receipt shows none or only a relative one. A receipt saved with such a
     * date lands in an old month, invisible in the web app and in the history
     * list, and the booked transaction never matches the bank/Trumf import.
     * Dates that are malformed, older than [MAX_AGE_DAYS] or in the future are
     * replaced by today and flagged so the review screen asks the user.
     */
    private fun withSaneDate(receipt: ParsedReceipt): ParsedReceipt {
        val fmt = java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).apply { isLenient = false }
        val parsed = if (receipt.date.matches(Regex("\\d{4}-\\d{2}-\\d{2}")))
            runCatching { fmt.parse(receipt.date) }.getOrNull() else null
        val now = java.util.Date()
        val dayMs = 24 * 60 * 60 * 1000L
        val ageDays = if (parsed != null) (now.time - parsed.time) / dayMs else Long.MAX_VALUE
        val plausible = parsed != null && ageDays in -1..MAX_AGE_DAYS
        if (plausible) return receipt
        Log.w(TAG, "Implausible receipt date '${receipt.date}' — replaced by today")
        return receipt.copy(date = isoDate(now), dateUncertain = true)
    }

    private fun sumDeviation(receipt: ParsedReceipt): Double =
        kotlin.math.abs(receipt.items.sumOf { it.totalPrice } - receipt.total)

    /**
     * Lines whose own numbers don't agree (quantity x unitPrice != totalPrice).
     * A misread digit on a "2 x 22,40" or "0,192 kg x 34,90" line shows up here,
     * so these are the first places to point the model at.
     */
    private fun inconsistentLines(receipt: ParsedReceipt): List<ParsedReceiptItem> =
        receipt.items.filter {
            !it.isDiscount && kotlin.math.abs(it.quantity * it.unitPrice - it.totalPrice) > SUM_TOLERANCE
        }

    private fun correctionText(receipt: ParsedReceipt): String {
        val itemSum = receipt.items.sumOf { it.totalPrice }
        val us = java.util.Locale.US
        return buildString {
            append(
                "Varelinjene dine summerer til %.2f, men kvitteringens totalbeløp er %.2f (avvik %.2f). "
                    .format(us, itemSum, receipt.total, itemSum - receipt.total)
            )
            val suspicious = inconsistentLines(receipt)
            if (suspicious.isNotEmpty()) {
                append("Disse linjene er internt inkonsistente (antall × pris ≠ linjesum) og er de mest sannsynlige feilkildene — les dem på nytt fra kvitteringen: ")
                suspicious.joinTo(this) {
                    "«${it.name}» %s × %.2f ≠ %.2f".format(us, it.quantity.toString(), it.unitPrice, it.totalPrice)
                }
                append(". ")
            }
            append(
                "Vanlige feil: et feillest siffer i en linjesum, en antall-/vektlinje tolket som egen vare, " +
                    "en dobbelttellet rabatt av variant 1, et parentesbeløp som ikke skulle telle med, " +
                    "en mix-blokk håndtert feil, en varelinje som mangler, eller en linje talt to ganger " +
                    "i overlappen mellom to utsnitt. Lever HELE varelisten på nytt, korrigert, slik at summen stemmer eksakt."
            )
        }
    }

    /** One API round trip; returns the parsed receipt plus the raw JSON text. */
    private fun requestParse(
        model: String,
        systemPrompt: String,
        messages: JSONArray
    ): Pair<ParsedReceipt, String> {
        val body = JSONObject().apply {
            put("model", model)
            put("max_tokens", 16000)
            put("system", systemPrompt)
            put("messages", messages)
            put("output_config", JSONObject().apply {
                put("format", JSONObject().apply {
                    put("type", "json_schema")
                    put("schema", receiptSchema())
                })
            })
        }

        val request = Request.Builder()
            .url(API_URL)
            .header("x-api-key", BuildConfig.ANTHROPIC_API_KEY)
            .header("anthropic-version", "2023-06-01")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()

        client.newCall(request).execute().use { response ->
            val responseText = response.body?.string() ?: ""
            if (!response.isSuccessful) {
                Log.e(TAG, "API error ${response.code}: $responseText")
                val apiMessage = runCatching {
                    JSONObject(responseText).getJSONObject("error").getString("message")
                }.getOrNull()
                throw RuntimeException(
                    "Claude API feilet (${response.code})" +
                        (apiMessage?.let { ": ${it.take(300)}" } ?: "")
                )
            }

            val json = JSONObject(responseText)
            when (val stopReason = json.optString("stop_reason")) {
                "end_turn" -> { /* ok */ }
                "max_tokens" -> throw RuntimeException("Kvitteringen er for stor (svaret ble avkuttet)")
                "refusal" -> throw RuntimeException("Modellen avviste forespørselen")
                else -> Log.w(TAG, "Unexpected stop_reason: $stopReason")
            }

            val content = json.getJSONArray("content")
            for (i in 0 until content.length()) {
                val block = content.getJSONObject(i)
                if (block.getString("type") == "text") {
                    val resultText = block.getString("text")
                    return toParsedReceipt(JSONObject(resultText)) to resultText
                }
            }
            throw RuntimeException("Tomt svar fra modellen")
        }
    }

    /**
     * Content blocks for the receipt itself: a PDF goes in as one document
     * block; an image becomes one or more labelled image strips (see
     * [imageStrips]).
     */
    private fun receiptBlocks(bytes: ByteArray, mimeType: String): List<JSONObject> {
        if (mimeType == "application/pdf") return listOf(base64Block("document", bytes, mimeType))
        val strips = imageStrips(bytes, mimeType)
        if (strips.size == 1) return listOf(base64Block("image", strips[0].first, strips[0].second))
        return strips.flatMapIndexed { i, (data, mime) ->
            listOf(
                JSONObject().put("type", "text").put("text", "Utsnitt ${i + 1} av ${strips.size} (ovenfra og ned):"),
                base64Block("image", data, mime)
            )
        }
    }

    private fun base64Block(type: String, bytes: ByteArray, mimeType: String): JSONObject =
        JSONObject().apply {
            put("type", type)
            put("source", JSONObject().apply {
                put("type", "base64")
                put("media_type", mimeType)
                put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
            })
        }

    /**
     * Cuts an image into horizontal strips that each stay within the model's
     * native resolution (see the VISION_* constants), so the API never has to
     * shrink a tall receipt to an unreadable width. Images that already fit are
     * returned untouched (no re-encoding); wider images are first scaled down
     * to [TILE_MAX_WIDTH]. Strips are equal-height and overlap by
     * [TILE_OVERLAP_PX]. Returns (bytes, mimeType) per strip, top to bottom.
     */
    private fun imageStrips(bytes: ByteArray, mimeType: String): List<Pair<ByteArray, String>> {
        val asIs = listOf(bytes to mimeType)
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val srcW = bounds.outWidth
        val srcH = bounds.outHeight
        // Undecodable image: send as-is and let the API report what's wrong
        if (srcW <= 0 || srcH <= 0) return asIs

        val targetW = minOf(srcW, TILE_MAX_WIDTH)
        val targetH = (srcH.toLong() * targetW / srcW).toInt().coerceAtLeast(1)
        val widthPatches = (targetW + VISION_PATCH_PX - 1) / VISION_PATCH_PX
        val maxStripH = minOf((VISION_MAX_PATCHES / widthPatches) * VISION_PATCH_PX, VISION_MAX_EDGE_PX)
        if (targetW == srcW && srcH <= maxStripH && bytes.size <= MAX_IMAGE_BYTES) return asIs

        // Decode at reduced size when possible (inSampleSize halves), keeping width >= target
        val options = BitmapFactory.Options().apply {
            inSampleSize = 1
            while (srcW / (inSampleSize * 2) >= targetW) inSampleSize *= 2
        }
        var bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return asIs
        if (bitmap.width != targetW || bitmap.height != targetH) {
            val scaled = Bitmap.createScaledBitmap(bitmap, targetW, targetH, true)
            if (scaled !== bitmap) bitmap.recycle()
            bitmap = scaled
        }

        val step = maxStripH - TILE_OVERLAP_PX
        val count = if (targetH <= maxStripH) 1
            else (targetH - TILE_OVERLAP_PX + step - 1) / step
        // Equal-height strips with exactly TILE_OVERLAP_PX shared rows
        val stripH = if (count == 1) targetH
            else (targetH + (count - 1) * TILE_OVERLAP_PX + count - 1) / count
        // Screenshots stay lossless PNG; photos are re-encoded as high-quality JPEG
        val (format, outMime) = if (mimeType == "image/png") Bitmap.CompressFormat.PNG to "image/png"
            else Bitmap.CompressFormat.JPEG to "image/jpeg"

        val strips = (0 until count).map { i ->
            val top = i * (stripH - TILE_OVERLAP_PX)
            val h = minOf(stripH, targetH - top)
            val strip = Bitmap.createBitmap(bitmap, 0, top, targetW, h)
            val out = java.io.ByteArrayOutputStream()
            strip.compress(format, 92, out)
            if (strip !== bitmap) strip.recycle()
            out.toByteArray() to outMime
        }
        bitmap.recycle()
        Log.i(
            TAG,
            "Image ${srcW}x${srcH} (${bytes.size} B) -> $count strip(s) of ${targetW}x$stripH, " +
                "${strips.sumOf { it.first.size }} B $outMime"
        )
        return strips
    }

    /** Sniffs the real file type from magic bytes; falls back to a usable mime hint. */
    private fun detectMime(bytes: ByteArray, hint: String?): String? {
        fun startsWith(vararg magic: Int) =
            bytes.size >= magic.size && magic.withIndex().all { (i, b) -> bytes[i] == b.toByte() }

        return when {
            startsWith(0x25, 0x50, 0x44, 0x46) -> "application/pdf"          // %PDF
            startsWith(0x89, 0x50, 0x4E, 0x47) -> "image/png"
            startsWith(0xFF, 0xD8, 0xFF) -> "image/jpeg"
            bytes.size >= 12 && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP" -> "image/webp"
            startsWith(0x47, 0x49, 0x46) -> "image/gif"                       // GIF
            hint == "application/pdf" || hint?.startsWith("image/") == true -> hint
            else -> null
        }
    }

    /**
     * Deterministic safety net on top of the model's normalization so trivial
     * variants ("q-melk" vs "q melk", "1,75l" vs "1.75l") can't split the
     * price statistics.
     */
    private fun canonicalizeName(raw: String): String = raw
        .lowercase()
        .replace(Regex("(?<=\\d),(?=\\d)"), ".")
        .replace(Regex("[-_/]"), " ")
        .replace(Regex("\\s+"), " ")
        .trim()

    private fun toParsedReceipt(json: JSONObject): ParsedReceipt {
        val itemsJson = json.getJSONArray("items")
        val items = (0 until itemsJson.length()).map { i ->
            val item = itemsJson.getJSONObject(i)
            ParsedReceiptItem(
                name = item.getString("name"),
                normalizedName = canonicalizeName(item.getString("normalizedName")),
                category = item.getString("category"),
                quantity = item.getDouble("quantity"),
                unit = item.getString("unit"),
                unitPrice = item.getDouble("unitPrice"),
                totalPrice = item.getDouble("totalPrice"),
                discount = item.optDouble("discount", 0.0),
                isDiscount = item.getBoolean("isDiscount"),
                isPant = item.getBoolean("isPant")
            )
        }
        return ParsedReceipt(
            store = json.getString("store"),
            chain = json.getString("chain"),
            date = json.getString("date"),
            total = json.getDouble("total"),
            items = items
        )
    }

    private fun receiptSchema(): JSONObject {
        val itemSchema = JSONObject().apply {
            put("type", "object")
            put("additionalProperties", false)
            put("required", JSONArray(listOf(
                "name", "normalizedName", "category", "quantity",
                "unit", "unitPrice", "totalPrice", "discount", "isDiscount", "isPant"
            )))
            put("properties", JSONObject().apply {
                put("name", JSONObject().put("type", "string")
                    .put("description", "Varenavn slik det står på kvitteringen"))
                put("normalizedName", JSONObject().put("type", "string")
                    .put("description", "Normalisert varenavn for prisstatistikk"))
                put("category", JSONObject().put("type", "string")
                    .put("enum", JSONArray(CATEGORIES)))
                put("quantity", JSONObject().put("type", "number"))
                put("unit", JSONObject().put("type", "string")
                    .put("enum", JSONArray(listOf("stk", "kg", "l"))))
                put("unitPrice", JSONObject().put("type", "number"))
                put("totalPrice", JSONObject().put("type", "number")
                    .put("description", "Linjesum i NOK slik den bidrar til totalen (netto), negativ for rene rabattlinjer"))
                put("discount", JSONObject().put("type", "number")
                    .put("description", "Rabatt i NOK som allerede er trukket fra totalPrice. 0 hvis ingen rabatt."))
                put("isDiscount", JSONObject().put("type", "boolean"))
                put("isPant", JSONObject().put("type", "boolean"))
            })
        }
        return JSONObject().apply {
            put("type", "object")
            put("additionalProperties", false)
            put("required", JSONArray(listOf("store", "chain", "date", "total", "items")))
            put("properties", JSONObject().apply {
                put("store", JSONObject().put("type", "string")
                    .put("description", "Butikknavn, f.eks. 'Extra Lade'"))
                put("chain", JSONObject().put("type", "string").put("enum", JSONArray(listOf(
                    "coop_extra", "coop_obs", "coop_prix", "coop_mega", "coop_marked",
                    "matkroken", "rema_1000", "kiwi", "meny", "spar", "joker", "bunnpris", "annet"
                ))))
                put("date", JSONObject().put("type", "string")
                    .put("description", "Kjøpsdato YYYY-MM-DD"))
                put("total", JSONObject().put("type", "number")
                    .put("description", "Totalbeløp betalt i NOK"))
                put("items", JSONObject().put("type", "array").put("items", itemSchema))
            })
        }
    }
}
