package com.benchmarkwatcher.nativeapp

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.viewmodel.compose.viewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { ResearchTheme { ResearchApp(viewModel()) } }
    }
}

@Composable
fun ResearchTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) darkColorScheme(primary = Color(0xFFA8C7FA), background = Color(0xFF111318), surface = Color(0xFF181B21), surfaceContainer = Color(0xFF22262E))
    else lightColorScheme(primary = Color(0xFF185ABC), background = Color(0xFFF7F8FA), surface = Color.White, surfaceContainer = Color(0xFFF0F3F8))
    MaterialTheme(colorScheme = colors, content = content)
}
