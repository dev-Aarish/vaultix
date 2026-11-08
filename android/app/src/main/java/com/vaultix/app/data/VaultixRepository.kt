package com.vaultix.app.data

import com.google.gson.Gson
import com.vaultix.app.security.DeviceKeyManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import retrofit2.HttpException
import java.io.IOException

class ApiException(val code: String, message: String) : Exception(message)

class VaultixRepository(
    private val api: VaultixApi,
    private val deviceKeys: DeviceKeyManager,
    private val sessionStore: SessionStore,
) {
    fun hasSession(): Boolean = sessionStore.token != null

    fun clearSession() {
        sessionStore.clear()
    }

    suspend fun login(email: String, password: String): Result<PublicUser> = apiCall {
        val response = api.login(LoginRequest(email.trim(), password))
        sessionStore.token = response.data.token
        response.data.user
    }

    suspend fun register(invitationToken: String, name: String, password: String): Result<PublicUser> =
        apiCall {
            api.register(
                RegisterRequest(invitationToken.trim(), name.trim(), password),
            ).data.user
        }

    suspend fun logout() {
        val authorization = sessionStore.token?.let { "Bearer $it" }
        try {
            if (authorization != null) {
                api.logout(authorization)
            }
        } catch (_: Exception) {
        } finally {
            sessionStore.clear()
        }
    }

    suspend fun me(): Result<MeData> = authorized { authorization -> api.me(authorization).data }

    suspend fun devices(): Result<List<DeviceDto>> =
        authorized { authorization -> api.devices(authorization).data }

    suspend fun registerDevice(deviceName: String): Result<DeviceDto> = authorized { authorization ->
        val keyPair = deviceKeys.getOrCreateKeyPair()
        val registered = api.registerDevice(
            authorization,
            DeviceRegisterRequest(deviceName, deviceKeys.publicKeyBase64(keyPair)),
        )
        val challenge = registered.data.challenge
        val signature = deviceKeys.sign(challenge.challenge)
        api.verify(
            authorization,
            VerifyRequest(registered.data.device.id, challenge.id, signature),
        ).data.device
    }

    suspend fun bindSession(deviceId: String): Result<DeviceDto> = authorized { authorization ->
        val challenge = api.challenge(
            authorization,
            ChallengeRequest(deviceId, "SESSION"),
        ).data.challenge
        val signature = deviceKeys.sign(challenge.challenge)
        api.verify(
            authorization,
            VerifyRequest(deviceId, challenge.id, signature),
        ).data.device
    }

    private suspend fun <T> authorized(block: suspend (String) -> T): Result<T> {
        val token = sessionStore.token
            ?: return Result.failure(
                ApiException("UNAUTHENTICATED", "Your session has expired. Sign in again."),
            )
        return apiCall { block("Bearer $token") }
    }

    private suspend fun <T> apiCall(block: suspend () -> T): Result<T> = withContext(Dispatchers.IO) {
        try {
            Result.success(block())
        } catch (error: HttpException) {
            Result.failure(toApiException(error))
        } catch (_: IOException) {
            Result.failure(
                ApiException(
                    "NETWORK_ERROR",
                    "Cannot reach the server. Check your connection and try again.",
                ),
            )
        } catch (error: Exception) {
            Result.failure(ApiException("UNEXPECTED_ERROR", error.message ?: "Something went wrong"))
        }
    }

    private fun toApiException(error: HttpException): ApiException {
        val body = runCatching { error.response()?.errorBody()?.string() }.getOrNull()
        val parsed = runCatching {
            Gson().fromJson(body, ApiErrorEnvelope::class.java)
        }.getOrNull()
        val code = parsed?.error?.code ?: "HTTP_${error.code()}"
        val fallback = when (error.code()) {
            401 -> "Your session has expired. Sign in again."
            403 -> "You are not allowed to do that."
            404 -> "That item could not be found."
            else -> "Request failed (${error.code()})."
        }
        return ApiException(code, parsed?.error?.message ?: fallback)
    }
}
