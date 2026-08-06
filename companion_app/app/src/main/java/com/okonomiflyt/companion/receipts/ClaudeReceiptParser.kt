package com.okonomiflyt.companion.receipts

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
        // Line items must sum to the receipt total within this (øre rounding)
        private const val SUM_TOLERANCE = 0.05

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
- KONTROLL: summen av alle totalPrice (inkl. pant og ev. negative rabattlinjer) skal være eksakt lik totalbeløpet. Stemmer det ikke, har du sannsynligvis dobbelttellet en rabatt av variant 1 — rett det opp før du svarer.
- date er kjøpsdato i formatet YYYY-MM-DD. total er beløpet som faktisk ble betalt."""
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

                val mimeType = detectMime(fileBytes, mimeHint)
                    ?: return@withContext Result.failure(
                        RuntimeException(
                            "Ukjent filtype (ikke PDF eller bilde). Mottatt mime: $mimeHint"
                        )
                    )

                val base64Data = Base64.encodeToString(fileBytes, Base64.NO_WRAP)
                val fileBlock = JSONObject().apply {
                    put("type", if (mimeType == "application/pdf") "document" else "image")
                    put("source", JSONObject().apply {
                        put("type", "base64")
                        put("media_type", mimeType)
                        put("data", base64Data)
                    })
                }

                val systemPrompt = buildString {
                    append(SYSTEM_PROMPT)
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

                val messages = JSONArray().put(userMessage(
                    fileBlock,
                    "Analyser denne kvitteringen og trekk ut alle varelinjer."
                ))
                if (feedback != null && previousRaw != null) {
                    messages.put(JSONObject().apply {
                        put("role", "assistant")
                        put("content", previousRaw)
                    })
                    messages.put(userMessage(
                        null,
                        "Brukeren har sett gjennom analysen din og kommenterer: «$feedback». " +
                            "Rett opp i henhold til kommentaren og lever HELE varelisten på nytt."
                    ))
                }

                // Attempt 1: primary model
                val (first, firstRaw) = requestParse(MODEL, systemPrompt, messages)
                var best = first.copy(parseAttempts = 1, parseModel = MODEL, rawJson = firstRaw)
                if (sumDeviation(best) <= SUM_TOLERANCE) return@withContext Result.success(best)

                // Attempt 2: same model, told exactly how far off it was
                Log.w(TAG, "Sum check failed (${sumDeviation(best)}), asking model to self-correct")
                messages.put(JSONObject().apply {
                    put("role", "assistant")
                    put("content", firstRaw)
                })
                messages.put(userMessage(null, correctionText(best)))
                runCatching { requestParse(MODEL, systemPrompt, messages) }
                    .onSuccess { (second, secondRaw) ->
                        if (sumDeviation(second) < sumDeviation(best)) {
                            best = second.copy(parseAttempts = 2, parseModel = MODEL, rawJson = secondRaw)
                        }
                    }
                if (sumDeviation(best) <= SUM_TOLERANCE) return@withContext Result.success(best)

                // Attempt 3: stronger model, fresh conversation
                Log.w(TAG, "Still off (${sumDeviation(best)}), escalating to $FALLBACK_MODEL")
                val freshMessages = JSONArray().put(userMessage(
                    fileBlock,
                    "Analyser denne kvitteringen og trekk ut alle varelinjer."
                ))
                runCatching { requestParse(FALLBACK_MODEL, systemPrompt, freshMessages) }
                    .onSuccess { (third, thirdRaw) ->
                        if (sumDeviation(third) < sumDeviation(best)) {
                            best = third.copy(parseAttempts = 3, parseModel = FALLBACK_MODEL, rawJson = thirdRaw)
                        }
                    }

                Result.success(best)
            } catch (e: Exception) {
                Log.e(TAG, "Failed to parse receipt", e)
                Result.failure(e)
            }
        }

    private fun userMessage(fileBlock: JSONObject?, text: String): JSONObject {
        val content = JSONArray()
        if (fileBlock != null) content.put(fileBlock)
        content.put(JSONObject().put("type", "text").put("text", text))
        return JSONObject().put("role", "user").put("content", content)
    }

    private fun sumDeviation(receipt: ParsedReceipt): Double =
        kotlin.math.abs(receipt.items.sumOf { it.totalPrice } - receipt.total)

    private fun correctionText(receipt: ParsedReceipt): String {
        val itemSum = receipt.items.sumOf { it.totalPrice }
        return "Varelinjene dine summerer til %.2f, men kvitteringens totalbeløp er %.2f (avvik %.2f). Finn feilen — typisk en dobbelttellet rabatt, et parentesbeløp som ikke skulle telle med, eller en mix-blokk som er håndtert feil — og lever HELE varelisten på nytt, korrigert, slik at summen stemmer eksakt."
            .format(itemSum, receipt.total, itemSum - receipt.total)
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
                throw RuntimeException("Claude API feilet (${response.code})")
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
