package com.vaultix.app.data

data class ApiErrorDetail(val code: String = "", val message: String = "")
data class ApiErrorEnvelope(val error: ApiErrorDetail? = null)

data class PublicUser(
    val id: String = "",
    val name: String = "",
    val email: String = "",
    val role: String = "USER",
    val status: String = "PENDING",
    val emailVerifiedAt: String? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
)

data class DeviceDto(
    val id: String = "",
    val userId: String = "",
    val deviceName: String = "",
    val keyFingerprint: String = "",
    val attestationStatus: String = "UNVERIFIED",
    val status: String = "PENDING",
    val proofVerifiedAt: String? = null,
    val createdAt: String = "",
    val lastSeenAt: String? = null,
    val revokedAt: String? = null,
)

data class LoginRequest(val email: String, val password: String)
data class LoginData(val token: String, val expiresAt: String, val user: PublicUser)
data class LoginResponse(val data: LoginData)

data class RegisterRequest(val token: String, val name: String, val password: String)
data class RegisterData(val user: PublicUser)
data class RegisterResponse(val data: RegisterData)

data class MeData(val user: PublicUser, val device: DeviceDto?)
data class MeResponse(val data: MeData)

data class DevicesResponse(val data: List<DeviceDto>)

data class DeviceRegisterRequest(val deviceName: String, val publicKey: String)
data class ChallengeDto(
    val id: String = "",
    val challenge: String = "",
    val purpose: String = "",
    val expiresAt: String = "",
)
data class DeviceRegisterData(val device: DeviceDto, val challenge: ChallengeDto)
data class DeviceRegisterResponse(val data: DeviceRegisterData)

data class ChallengeRequest(val deviceId: String, val purpose: String)
data class ChallengeData(val challenge: ChallengeDto)
data class ChallengeResponse(val data: ChallengeData)

data class VerifyRequest(val deviceId: String, val challengeId: String, val signature: String)
data class VerifyData(val device: DeviceDto, val deviceBound: Boolean? = null)
data class VerifyResponse(val data: VerifyData)
