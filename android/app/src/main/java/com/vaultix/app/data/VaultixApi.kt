package com.vaultix.app.data

import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

interface VaultixApi {
    @POST("auth/register")
    suspend fun register(@Body request: RegisterRequest): RegisterResponse

    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @POST("auth/logout")
    suspend fun logout(@Header("Authorization") authorization: String): Response<Unit>

    @GET("auth/me")
    suspend fun me(@Header("Authorization") authorization: String): MeResponse

    @GET("me/devices")
    suspend fun devices(@Header("Authorization") authorization: String): DevicesResponse

    @POST("devices/register")
    suspend fun registerDevice(
        @Header("Authorization") authorization: String,
        @Body request: DeviceRegisterRequest,
    ): DeviceRegisterResponse

    @POST("devices/challenge")
    suspend fun challenge(
        @Header("Authorization") authorization: String,
        @Body request: ChallengeRequest,
    ): ChallengeResponse

    @POST("devices/verify")
    suspend fun verify(
        @Header("Authorization") authorization: String,
        @Body request: VerifyRequest,
    ): VerifyResponse

    @GET("files")
    suspend fun browse(
        @Header("Authorization") authorization: String,
        @Query("folderId") folderId: String?,
    ): BrowseResponse

    @GET("files/{id}/metadata")
    suspend fun fileMetadata(
        @Header("Authorization") authorization: String,
        @Path("id") id: String,
    ): FileMetadataResponse
}
