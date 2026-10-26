package com.benchmarkwatcher.nativeapp

import android.content.Context
import android.util.AtomicFile
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLEncoder

data class Library(val followed: List<Company> = emptyList(), val reports: Map<String, Report> = emptyMap(),
                   val reviewed: Map<String, Report> = emptyMap(), val notes: List<ResearchNote> = emptyList())

class ResearchRepository(context: Context, private val baseUrl: String = BuildConfig.RESEARCH_API_URL) {
    private val file = AtomicFile(File(context.filesDir, "research.json"))
    private var readable = true
    init {
        val uri = URI(baseUrl)
        require(uri.scheme == "https" || (BuildConfig.DEBUG && uri.host in setOf("127.0.0.1", "localhost", "10.0.2.2"))) { "HTTPS is required" }
    }
    suspend fun load(): Library = withContext(Dispatchers.IO) {
        if (!file.baseFile.exists()) return@withContext Library()
        try {
            val json = JSONObject(String(file.readFully(), Charsets.UTF_8))
            fun reports(key: String) = json.getJSONArray(key).objects().map(Report::decode).associateBy { it.cik }
            Library(json.getJSONArray("followed").objects().map(Company::decode), reports("reports"), reports("reviewed"), json.getJSONArray("notes").objects().map(ResearchNote::decode))
        } catch (error: Exception) { readable = false; throw IllegalStateException("Your research library could not be read and has been left intact.", error) }
    }
    suspend fun save(library: Library) = withContext(Dispatchers.IO) {
        check(readable) { "Restore access to your existing research library before saving changes." }
        val json = JSONObject().put("followed", JSONArray(library.followed.map { it.json() }))
            .put("reports", JSONArray(library.reports.values.map { JSONObject(it.raw) }))
            .put("reviewed", JSONArray(library.reviewed.values.map { JSONObject(it.raw) }))
            .put("notes", JSONArray(library.notes.map { it.json() }))
        val stream = file.startWrite()
        try { stream.write(json.toString().toByteArray(Charsets.UTF_8)); file.finishWrite(stream) }
        catch (error: Exception) { file.failWrite(stream); throw error }
    }
    private suspend fun get(path: String): JSONObject = withContext(Dispatchers.IO) {
        val connection = URL(baseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection
        connection.connectTimeout = 10000; connection.readTimeout = 45000; connection.instanceFollowRedirects = false
        connection.setRequestProperty("Accept", "application/json")
        try {
            val status = connection.responseCode
            val input = if (status == 200) connection.inputStream else connection.errorStream
            require(input != null) { "The research service is unavailable." }
            val output = java.io.ByteArrayOutputStream()
            input.use { stream ->
                val buffer = ByteArray(8192)
                while (true) {
                    currentCoroutineContext().ensureActive()
                    val size = stream.read(buffer)
                    if (size < 0) break
                    check(output.size() + size <= 4 * 1024 * 1024) { "Response exceeds the supported size." }
                    output.write(buffer, 0, size)
                }
            }
            val json = JSONObject(output.toString("UTF-8"))
            check(status == 200) { json.optString("error", "The research service is unavailable. Try again later.") }
            check(json.getInt("schema_version") == 1) { "Unsupported research response." }
            json
        } finally { connection.disconnect() }
    }
    suspend fun search(query: String): Pair<List<Company>, Boolean> {
        val json = get("/api/v1/research/companies?q=" + URLEncoder.encode(query, "UTF-8"))
        return json.getJSONArray("companies").objects().map(Company::decode) to json.getBoolean("stale")
    }
    suspend fun report(cik: String): Report {
        require(cik.matches(Regex("[0-9]{10}")))
        val report = Report.decode(get("/api/v1/research/companies/$cik").getJSONObject("report"))
        check(report.cik == cik) { "The filing identity did not match the selected company." }
        return report
    }
}
