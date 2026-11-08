package com.vaultix.app.ui

import android.app.Application
import android.os.Build
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.vaultix.app.data.ApiClientFactory
import com.vaultix.app.data.ApiException
import com.vaultix.app.data.BrowseData
import com.vaultix.app.data.DeviceDto
import com.vaultix.app.data.FileMetadataData
import com.vaultix.app.data.PublicUser
import com.vaultix.app.data.SessionStore
import com.vaultix.app.data.VaultixRepository
import com.vaultix.app.data.ViewSessionData
import com.vaultix.app.security.DeviceKeyManager
import com.vaultix.app.security.DeviceSecurityChecker
import com.vaultix.app.viewer.PdfDocumentManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.io.File
import java.util.UUID

enum class Stage {
    LOADING,
    LOGIN,
    REGISTER,
    DEVICE_SETUP,
    DEVICE_PENDING,
    DEVICE_ACTIVATING,
    HOME,
    VIEWING_DOCUMENT,
    DEVICE_REVOKED,
}

data class AppUiState(
    val stage: Stage = Stage.LOADING,
    val user: PublicUser? = null,
    val devices: List<DeviceDto> = emptyList(),
    val boundDevice: DeviceDto? = null,
    val browse: BrowseData? = null,
    val browserLoading: Boolean = false,
    val selectedFile: FileMetadataData? = null,
    val viewSession: ViewSessionData? = null,
    val viewerLocked: Boolean = false,
    val reauthBusy: Boolean = false,
    val reauthError: String? = null,
    val busy: Boolean = false,
    val securityWarnings: List<String> = emptyList(),
    val error: String? = null,
    val info: String? = null,
)

class VaultixViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = VaultixRepository(
        api = ApiClientFactory.create(),
        deviceKeys = DeviceKeyManager(),
        sessionStore = SessionStore(application),
    )

    val documentManager = PdfDocumentManager()

    override fun onCleared() {
        super.onCleared()
        documentManager.close()
    }

    private val _state = MutableStateFlow(AppUiState())
    val state: StateFlow<AppUiState> = _state.asStateFlow()

    init {
        val assessment = DeviceSecurityChecker.assessSecurity(application)
        if (assessment.warnings.isNotEmpty()) {
            _state.update { it.copy(securityWarnings = assessment.warnings) }
        }
        restoreSession()
    }

    private fun restoreSession() {
        viewModelScope.launch {
            if (!repository.hasSession()) {
                _state.value = AppUiState(stage = Stage.LOGIN)
                return@launch
            }
            refreshAccess()
        }
    }

    private suspend fun refreshAccess() {
        val me = repository.me().getOrElse { failure ->
            handleFailure(failure)
            return
        }
        val devices = repository.devices().getOrElse { failure ->
            handleFailure(failure)
            return
        }
        val boundDevice = me.device
        val activeDevice = devices.firstOrNull { it.status == "APPROVED" }
            ?: devices.firstOrNull { it.status == "PENDING" }
            ?: devices.firstOrNull()

        _state.update {
            it.copy(
                user = me.user,
                devices = devices,
                boundDevice = boundDevice,
                busy = false,
                error = null,
            )
        }

        when {
            boundDevice != null -> {
                _state.update { it.copy(stage = Stage.HOME) }
                loadFilesInternal(null)
            }

            activeDevice == null -> _state.update { it.copy(stage = Stage.DEVICE_SETUP) }
            activeDevice.status == "REVOKED" -> _state.update { it.copy(stage = Stage.DEVICE_REVOKED) }
            activeDevice.status == "PENDING" -> _state.update { it.copy(stage = Stage.DEVICE_PENDING) }
            else -> activateSession(activeDevice)
        }
    }

    private suspend fun activateSession(device: DeviceDto) {
        _state.update {
            it.copy(stage = Stage.DEVICE_ACTIVATING, busy = true, error = null, info = null)
        }
        repository.bindSession(device.id).fold(
            onSuccess = { bound ->
                _state.update {
                    it.copy(
                        stage = Stage.HOME,
                        boundDevice = bound,
                        busy = false,
                        info = null,
                    )
                }
                loadFilesInternal(null)
            },
            onFailure = { failure ->
                when ((failure as? ApiException)?.code) {
                    "DEVICE_NOT_APPROVED" -> _state.update {
                        it.copy(stage = Stage.DEVICE_PENDING, busy = false)
                    }

                    "DEVICE_REVOKED" -> _state.update {
                        it.copy(stage = Stage.DEVICE_REVOKED, busy = false)
                    }

                    else -> handleFailure(failure)
                }
            },
        )
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, info = null) }
            repository.login(email, password).fold(
                onSuccess = { user ->
                    _state.update {
                        it.copy(stage = Stage.LOADING, user = user, busy = false)
                    }
                    refreshAccess()
                },
                onFailure = { failure -> handleFailure(failure) },
            )
        }
    }

    fun register(invitationToken: String, name: String, password: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, info = null) }
            repository.register(invitationToken, name, password).fold(
                onSuccess = { user ->
                    repository.login(user.email, password).fold(
                        onSuccess = {
                            _state.update { state ->
                                state.copy(stage = Stage.LOADING, user = user, busy = false)
                            }
                            refreshAccess()
                        },
                        onFailure = { failure ->
                            if ((failure as? ApiException)?.code == "ACCOUNT_NOT_ACTIVE") {
                                _state.update {
                                    it.copy(
                                        stage = Stage.LOGIN,
                                        busy = false,
                                        error = null,
                                        info = "Account created. An administrator must approve it before you can sign in.",
                                    )
                                }
                            } else {
                                handleFailure(failure)
                            }
                        },
                    )
                },
                onFailure = { failure -> handleFailure(failure) },
            )
        }
    }

    fun registerDevice() {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null, info = null) }
            val assessment = DeviceSecurityChecker.assessSecurity(getApplication())
            val deviceName = listOf(Build.MANUFACTURER, Build.MODEL)
                .filter { it.isNotBlank() }
                .joinToString(" ")
                .ifBlank { "Android device" }
            repository.registerDevice(deviceName, assessment.attestationStatus).fold(
                onSuccess = { device ->
                    _state.update {
                        it.copy(
                            devices = listOf(device),
                            busy = false,
                            stage = Stage.DEVICE_PENDING,
                            securityWarnings = assessment.warnings,
                            info = "Device registered. Waiting for an administrator to approve it.",
                        )
                    }
                },
                onFailure = { failure -> handleFailure(failure) },
            )
        }
    }

    fun refreshStatus() {
        viewModelScope.launch {
            if (_state.value.stage != Stage.DEVICE_PENDING) return@launch
            val devices = repository.devices().getOrElse { return@launch }
            _state.update { it.copy(devices = devices) }
            val activeDevice = devices.firstOrNull { it.status == "APPROVED" }
                ?: devices.firstOrNull { it.status == "PENDING" }
                ?: devices.firstOrNull()

            when (activeDevice?.status) {
                "APPROVED" -> activateSession(activeDevice)
                "REVOKED" -> _state.update {
                    it.copy(stage = Stage.DEVICE_REVOKED, info = null)
                }

                else -> _state.update { it.copy(stage = Stage.DEVICE_PENDING) }
            }
        }
    }

    fun refreshFiles() {
        val folderId = _state.value.browse?.folder?.id
        viewModelScope.launch { loadFilesInternal(folderId) }
    }

    fun openFolder(folderId: String) {
        viewModelScope.launch { loadFilesInternal(folderId) }
    }

    fun goUp() {
        val breadcrumbs = _state.value.browse?.breadcrumbs ?: return
        val parentFolderId = if (breadcrumbs.size <= 1) {
            null
        } else {
            breadcrumbs[breadcrumbs.size - 2].id
        }
        viewModelScope.launch { loadFilesInternal(parentFolderId) }
    }

    fun openFile(fileId: String) {
        viewModelScope.launch {
            _state.update { it.copy(error = null) }
            repository.fileMetadata(fileId).fold(
                onSuccess = { metadata ->
                    _state.update { it.copy(selectedFile = metadata) }
                },
                onFailure = { failure -> handleFailure(failure) },
            )
        }
    }

    fun openSecureViewer(fileId: String) {
        viewModelScope.launch {
            _state.update { it.copy(busy = true, error = null) }
            repository.openViewingSession(fileId).fold(
                onSuccess = { sessionData ->
                    val tempFile = File(
                        getApplication<Application>().cacheDir,
                        "vaultix_view_${UUID.randomUUID().toString().take(8)}.pdf",
                    )
                    tempFile.deleteOnExit()
                    repository.downloadToPrivateTempFile(fileId, tempFile).fold(
                        onSuccess = {
                            try {
                                documentManager.open(tempFile)
                                _state.update {
                                    it.copy(
                                        stage = Stage.VIEWING_DOCUMENT,
                                        viewSession = sessionData,
                                        selectedFile = null,
                                        viewerLocked = false,
                                        reauthBusy = false,
                                        reauthError = null,
                                        busy = false,
                                    )
                                }
                            } catch (e: Exception) {
                                documentManager.close()
                                repository.wipeFile(tempFile)
                                _state.update {
                                    it.copy(
                                        busy = false,
                                        error = "Unable to render PDF document: ${e.message}",
                                    )
                                }
                            }
                        },
                        onFailure = { failure ->
                            repository.wipeFile(tempFile)
                            handleFailure(failure)
                        },
                    )
                },
                onFailure = { failure ->
                    handleFailure(failure)
                },
            )
        }
    }

    fun lockViewer() {
        _state.update { it.copy(viewerLocked = true, reauthError = null) }
    }

    fun unlockViewer(password: String) {
        val userEmail = _state.value.user?.email ?: return
        viewModelScope.launch {
            _state.update { it.copy(reauthBusy = true, reauthError = null) }
            repository.login(userEmail, password).fold(
                onSuccess = {
                    _state.update {
                        it.copy(
                            viewerLocked = false,
                            reauthBusy = false,
                            reauthError = null,
                        )
                    }
                },
                onFailure = { failure ->
                    val message = if ((failure as? ApiException)?.code == "INVALID_CREDENTIALS") {
                        "Incorrect password. Please try again."
                    } else {
                        (failure as? ApiException)?.message ?: "Reauthentication failed."
                    }
                    _state.update {
                        it.copy(
                            reauthBusy = false,
                            reauthError = message,
                        )
                    }
                },
            )
        }
    }

    fun closeSecureViewer() {
        documentManager.close()
        _state.update {
            it.copy(
                stage = Stage.HOME,
                viewSession = null,
                viewerLocked = false,
                reauthBusy = false,
                reauthError = null,
            )
        }
    }

    fun dismissFile() {
        _state.update { it.copy(selectedFile = null) }
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }

    private suspend fun loadFilesInternal(folderId: String?) {
        _state.update { it.copy(browserLoading = true, error = null) }
        repository.browse(folderId).fold(
            onSuccess = { data ->
                _state.update { it.copy(browse = data, browserLoading = false) }
            },
            onFailure = { failure ->
                _state.update { it.copy(browserLoading = false) }
                handleFailure(failure)
            },
        )
    }

    fun logout() {
        viewModelScope.launch {
            documentManager.close()
            _state.update { it.copy(busy = true) }
            repository.logout()
            _state.value = AppUiState(stage = Stage.LOGIN)
        }
    }

    fun showRegister() {
        _state.update { it.copy(stage = Stage.REGISTER, error = null, info = null) }
    }

    fun showLogin() {
        _state.update { it.copy(stage = Stage.LOGIN, error = null, info = null) }
    }

    fun clearMessages() {
        _state.update { it.copy(error = null, info = null) }
    }

    private fun handleFailure(failure: Throwable) {
        if ((failure as? ApiException)?.code == "UNAUTHENTICATED") {
            repository.clearSession()
            _state.update {
                AppUiState(
                    stage = Stage.LOGIN,
                    error = failure.message,
                )
            }
            return
        }

        val message = (failure as? ApiException)?.message
            ?: failure.message
            ?: "Something went wrong."
        _state.update { current ->
            current.copy(
                stage = if (current.stage == Stage.LOADING) Stage.LOGIN else current.stage,
                busy = false,
                error = message,
            )
        }
    }
}
