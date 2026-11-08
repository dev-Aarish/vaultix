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

data class FolderDto(
    val id: String = "",
    val parentFolderId: String? = null,
    val name: String = "",
    val status: String = "ACTIVE",
    val createdAt: String = "",
    val updatedAt: String = "",
)

data class FileDto(
    val id: String = "",
    val folderId: String? = null,
    val name: String = "",
    val mimeType: String = "application/octet-stream",
    val sizeBytes: Long = 0,
    val checksum: String = "",
    val status: String = "ACTIVE",
    val createdAt: String = "",
    val updatedAt: String = "",
)

data class BrowseItemDto(
    val type: String = "FILE",
    val id: String = "",
    val name: String = "",
    val parentFolderId: String? = null,
    val folderId: String? = null,
    val mimeType: String? = null,
    val sizeBytes: Long? = null,
    val createdAt: String = "",
    val updatedAt: String = "",
    val allowedActions: List<String> = emptyList(),
)

data class BrowseData(
    val folder: FolderDto? = null,
    val breadcrumbs: List<FolderDto> = emptyList(),
    val items: List<BrowseItemDto> = emptyList(),
)

data class BrowseResponse(val data: BrowseData)

data class FileMetadataData(
    val file: FileDto,
    val breadcrumbs: List<FolderDto> = emptyList(),
    val allowedActions: List<String> = emptyList(),
)

data class FileMetadataResponse(val data: FileMetadataData)

data class WatermarkDto(
    val userName: String = "",
    val userEmail: String = "",
    val deviceName: String = "",
    val deviceFingerprint: String = "",
    val classification: String = "CONFIDENTIAL • RESTRICTED",
    val timestamp: String = "",
)

data class ViewSessionData(
    val viewSessionId: String = "",
    val file: FileDto = FileDto(),
    val watermark: WatermarkDto = WatermarkDto(),
    val inactivityTimeoutSeconds: Long = 60,
)

data class OpenViewSessionResponse(val data: ViewSessionData)
