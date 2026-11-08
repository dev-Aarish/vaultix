package com.vaultix.app

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vaultix.app.ui.VaultixApp
import com.vaultix.app.ui.VaultixViewModel
import com.vaultix.app.ui.theme.VaultixTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        setContent {
            VaultixTheme {
                val viewModel: VaultixViewModel = viewModel()
                VaultixApp(viewModel)
            }
        }
    }
}
