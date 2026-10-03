package com.benchmarkwatcher.nativeapp

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class ResearchModelsTest {
    private fun fixture() = JSONObject(requireNotNull(javaClass.classLoader?.getResource("report.json")).readText())
    @Test fun contractPreservesDerivedSources() {
        val report = Report.decode(fixture())
        val value = report.metrics.first { it.id == "operating_cash" }.values.getValue("Q4-2025")
        assertEquals(126_000_000.0, value.value, 0.01)
        assertEquals(2, value.sources.size)
        assertTrue(value.sources.all { it.safeUrl != null })
        assertTrue(value.method.contains("Derived quarter"))
    }
    @Test fun missingPeriodsBreakLinesAndZeroIsRetained() {
        val json = fixture()
        val metrics = json.getJSONArray("metrics").objects()
        val values = metrics.first { it.getString("id") == "revenue" }.getJSONObject("values")
        values.remove("FY2022")
        values.getJSONObject("FY2024").put("value", 0)
        val report = Report.decode(json)
        val points = report.chart(report.metrics.first { it.id == "revenue" }, "annual")
        assertEquals(5, points.size)
        assertNotEquals(points.first().segment, points.last().segment)
        assertEquals(0.0, points.first { it.period.id == "FY2024" }.value.value, 0.0)
    }
    @Test fun sourceLinksRejectSpoofedHosts() {
        listOf("javascript:alert(1)", "http://www.sec.gov/Archives/edgar/data/1/x.htm", "https://www.sec.gov.evil.test/Archives/edgar/data/1/x.htm", "https://evil@www.sec.gov/Archives/edgar/data/1/x.htm").forEach { url ->
            assertNull(Source(url, "x", "10-K", "2026-01-01", null).safeUrl)
        }
    }
    @Test fun revisionsUseEvidenceAndNotesRoundTrip() {
        val old = Report.decode(fixture())
        val json = fixture()
        json.getJSONArray("metrics").objects().first { it.getString("id") == "revenue" }.getJSONObject("values").getJSONObject("FY2025").put("value", 1_450_000_000)
        val changes = reportChanges(old, Report.decode(json))
        assertEquals(1, changes.size)
        assertEquals(1_400_000_000.0, changes[0].previous!!, 0.01)
        val note = ResearchNote("id", old.cik, old.company, "Revenue", "FY2025", old.version, emptyList(), "Check the filing.", "2026-10-03")
        assertEquals(note, ResearchNote.decode(note.json()))
    }
    @Test fun differentUnitsAreNotComparedAsTheSameAmount() {
        val old = Report.decode(fixture())
        val json = fixture()
        json.getJSONArray("metrics").objects().first { it.getString("id") == "revenue" }.getJSONObject("values").getJSONObject("FY2025").put("unit", "EUR")
        val change = reportChanges(old, Report.decode(json)).single()
        assertNull(change.previous)
        assertEquals("EUR", change.unit)
    }
}
