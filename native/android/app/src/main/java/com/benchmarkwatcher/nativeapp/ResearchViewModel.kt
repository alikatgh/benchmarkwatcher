package com.benchmarkwatcher.nativeapp

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant
import java.util.UUID

data class ResearchState(val library: Library = Library(), val loading: Set<String> = emptySet(), val initialized: Boolean = false,
                         val query: String = "", val matches: List<Company> = emptyList(), val searching: Boolean = false,
                         val searchStale: Boolean = false, val searchError: String? = null, val error: String? = null)

class ResearchViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = ResearchRepository(application)
    private val mutable = MutableStateFlow(ResearchState())
    val state = mutable.asStateFlow()
    private val mutex = Mutex()
    private var searchJob: Job? = null
    init {
        viewModelScope.launch {
            try { val library = repository.load(); mutable.update { it.copy(library = library, initialized = true) } }
            catch (error: Exception) { mutable.update { it.copy(initialized = true, error = error.message) } }
        }
    }
    fun search(query: String) {
        searchJob?.cancel()
        mutable.update { it.copy(query = query, matches = emptyList(), searchError = null, searching = query.trim().length >= 2) }
        if (query.trim().length < 2) return
        searchJob = viewModelScope.launch {
            try {
                delay(350)
                val (matches, stale) = repository.search(query)
                mutable.update { if (it.query == query) it.copy(matches = matches, searching = false, searchStale = stale) else it }
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { mutable.update { if (it.query == query) it.copy(searching = false, searchError = error.message) else it } }
        }
    }
    fun load(cik: String, force: Boolean = false) {
        if (!mutable.value.initialized || cik in mutable.value.loading || (!force && cik in mutable.value.library.reports)) return
        mutable.update { it.copy(loading = it.loading + cik) }
        viewModelScope.launch {
            try {
                val report = repository.report(cik)
                modify { library -> library.copy(reports = library.reports + (cik to report), reviewed = if (cik in library.reviewed) library.reviewed else library.reviewed + (cik to report)) }
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) { mutable.update { it.copy(error = error.message ?: "Report unavailable") } }
            finally { mutable.update { it.copy(loading = it.loading - cik) } }
        }
    }
    fun follow(report: Report) {
        viewModelScope.launch { modify { library -> library.copy(followed = if (library.followed.any { it.cik == report.cik }) library.followed.filter { it.cik != report.cik } else library.followed + report.identity) } }
    }
    fun reviewed(report: Report) { viewModelScope.launch { modify { it.copy(reviewed = it.reviewed + (report.cik to report)) } } }
    fun note(report: Report, metric: Metric, point: ChartPoint?, text: String, finished: (Boolean) -> Unit) {
        val clean = text.trim()
        if (clean.isEmpty() || clean.length > 10000) return
        viewModelScope.launch {
            val note = ResearchNote(UUID.randomUUID().toString(), report.cik, report.company, metric.label, point?.period?.label, report.version,
                point?.value?.sources?.mapNotNull { it.safeUrl } ?: emptyList(), clean, Instant.now().toString())
            finished(modify { it.copy(notes = listOf(note) + it.notes) })
        }
    }
    fun dismissError() { mutable.update { it.copy(error = null) } }
    private suspend fun modify(transform: (Library) -> Library): Boolean = mutex.withLock {
        try {
            val library = transform(mutable.value.library)
            repository.save(library)
            mutable.update { it.copy(library = library) }
            true
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) { mutable.update { it.copy(error = error.message ?: "Changes could not be saved") }; false }
    }
}
