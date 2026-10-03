package com.benchmarkwatcher.nativeapp

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.text.NumberFormat
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.Locale

data class Company(val cik: String, val ticker: String, val name: String, val exchange: String, val suggested: Boolean = false) {
    fun json() = JSONObject().put("cik", cik).put("ticker", ticker).put("name", name).put("exchange", exchange).put("suggested", suggested)
    companion object {
        fun decode(json: JSONObject) = Company(json.getString("cik"), json.getString("ticker"), json.getString("name"), json.getString("exchange"), json.optBoolean("suggested"))
    }
}
data class Source(val url: String, val accession: String, val form: String, val filed: String, val tag: String?) {
    val safeUrl: String? get() = runCatching {
        val uri = URI(url)
        if (uri.scheme == "https" && uri.host == "www.sec.gov" && uri.userInfo == null && uri.port == -1 && uri.path.startsWith("/Archives/edgar/data/")) url else null
    }.getOrNull()
    companion object { fun decode(j: JSONObject) = Source(j.getString("url"), j.getString("accession"), j.getString("form"), j.getString("filed"), j.optionalString("tag")) }
}
data class Value(val value: Double, val unit: String, val start: String?, val end: String, val method: String, val sources: List<Source>) {
    companion object {
        fun decode(j: JSONObject): Value {
            val value = j.getDouble("value")
            require(value.isFinite()) { "Invalid financial value" }
            return Value(value, j.getString("unit"), j.optionalString("start"), j.getString("end"), j.getString("method"), j.getJSONArray("sources").objects().map(Source::decode))
        }
    }
}
data class Period(val id: String, val label: String, val frequency: String, val year: Int, val end: String) {
    companion object { fun decode(j: JSONObject) = Period(j.getString("id"), j.getString("label"), j.getString("frequency"), j.getInt("year"), j.getString("end")) }
}
data class Metric(val id: String, val label: String, val section: String, val behavior: String, val unit: String, val values: Map<String, Value>) {
    companion object {
        fun decode(j: JSONObject): Metric {
            val values = j.getJSONObject("values")
            return Metric(j.getString("id"), j.getString("label"), j.getString("section"), j.getString("behavior"), j.getString("unit"), values.keys().asSequence().associateWith { Value.decode(values.getJSONObject(it)) })
        }
    }
}
data class ChartPoint(val period: Period, val value: Value, val index: Int, val segment: Int)
data class Report(val cik: String, val company: String, val ticker: String, val exchange: String, val industry: String,
                  val currency: String, val checked: String, val stale: Boolean, val version: String, val periods: List<Period>,
                  val metrics: List<Metric>, val gaps: List<String>, val basis: String, val raw: String) {
    val identity get() = Company(cik, ticker, company, exchange)
    fun chart(metric: Metric, frequency: String): List<ChartPoint> {
        var segment = 0
        var previous: Period? = null
        return periods.filter { it.frequency == frequency }.sortedBy { it.end }.mapIndexedNotNull { index, period ->
            previous?.let {
                if ((frequency == "annual" && period.year - it.year > 1) || (frequency != "annual" && ChronoUnit.DAYS.between(LocalDate.parse(it.end), LocalDate.parse(period.end)) > 120)) segment++
            }
            previous = period
            val value = metric.values[period.id]
            if (value == null) { segment++; null } else ChartPoint(period, value, index, segment)
        }
    }
    companion object {
        fun decode(j: JSONObject): Report {
            val periods = j.getJSONArray("periods").objects().map(Period::decode)
            val metrics = j.getJSONArray("metrics").objects().map(Metric::decode)
            require(j.getString("cik").matches(Regex("[0-9]{10}")) && periods.isNotEmpty() && metrics.isNotEmpty()) { "Invalid company report" }
            require(periods.map { it.id }.toSet().size == periods.size && metrics.map { it.id }.toSet().size == metrics.size) { "Duplicate report identifiers" }
            return Report(j.getString("cik"), j.getString("company"), j.getString("ticker"), j.getString("exchange"), j.getString("industry"), j.getString("currency"), j.getString("checked"), j.getBoolean("stale"), j.getString("version"), periods, metrics,
                j.getJSONArray("gaps").strings(), j.getString("basis"), j.toString())
        }
    }
}
data class ResearchNote(val id: String, val cik: String, val company: String, val metric: String?, val period: String?, val version: String, val sources: List<String>, val text: String, val created: String) {
    fun json() = JSONObject().put("id", id).put("cik", cik).put("company", company).put("metric", metric ?: JSONObject.NULL)
        .put("period", period ?: JSONObject.NULL).put("version", version).put("sources", JSONArray(sources)).put("text", text).put("created", created)
    companion object { fun decode(j: JSONObject) = ResearchNote(j.getString("id"), j.getString("cik"), j.getString("company"), j.optionalString("metric"), j.optionalString("period"), j.getString("version"), j.getJSONArray("sources").strings(), j.getString("text"), j.getString("created")) }
}
data class ReportChange(val metric: String, val period: String, val previous: Double?, val current: Double, val unit: String)
fun reportChanges(old: Report, new: Report): List<ReportChange> {
    if (old.cik != new.cik) return emptyList()
    val lookup = old.metrics.associateBy { it.id }
    return new.metrics.flatMap { metric -> metric.values.mapNotNull { (id, value) ->
        val prior = lookup[metric.id]?.values?.get(id)
        val previous = prior?.takeIf { it.unit == value.unit }?.value
        val period = new.periods.firstOrNull { it.id == id } ?: return@mapNotNull null
        if (previous == value.value) null else ReportChange(metric.label, period.label, previous, value.value, value.unit)
    } }
}
fun compact(value: Double, unit: String): String {
    if (!value.isFinite()) return "—"
    val number = NumberFormat.getNumberInstance(Locale.getDefault())
    if (unit == "%") { number.minimumFractionDigits = 1; number.maximumFractionDigits = 1; return number.format(value) + "%" }
    number.minimumFractionDigits = 2; number.maximumFractionDigits = 2
    if (unit.contains("/share")) return number.format(value)
    listOf(1e12 to "T", 1e9 to "B", 1e6 to "M", 1e3 to "K").firstOrNull { kotlin.math.abs(value) >= it.first }?.let { return number.format(value / it.first) + it.second }
    return number.format(value)
}
fun JSONObject.optionalString(key: String): String? = if (!has(key) || isNull(key)) null else getString(key)
fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
