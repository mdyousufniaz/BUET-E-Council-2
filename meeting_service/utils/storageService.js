const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

// Configure S3 client (compatible with Cloudflare R2, AWS S3, MinIO)
const s3Client = new S3Client({
    region: process.env.R3_REGION || 'auto',
    endpoint: process.env.R3_ENDPOINT, // e.g. https://<account_id>.r2.cloudflarestorage.com
    credentials: {
        accessKeyId: process.env.R3_ACCESS_KEY_ID || 'your-access-key-id',
        secretAccessKey: process.env.R3_SECRET_ACCESS_KEY || 'your-secret-access-key',
    },
    forcePathStyle: true // Needed for MinIO locally
});

const BUCKET_NAME = process.env.R3_BUCKET_NAME || 'ecouncil-bucket';

/**
 * Upload a file to R3
 */
const uploadFile = async (fileBuffer, fileName, mimeType) => {
    const params = {
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: fileBuffer,
        ContentType: mimeType,
    };

    try {
        const command = new PutObjectCommand(params);
        await s3Client.send(command);
        return { success: true, key: fileName };
    } catch (error) {
        console.error("Error uploading file to R3:", error);
        throw error;
    }
};

/**
 * Delete a file from R3
 */
const deleteFile = async (fileName) => {
    const params = {
        Bucket: BUCKET_NAME,
        Key: fileName,
    };

    try {
        const command = new DeleteObjectCommand(params);
        await s3Client.send(command);
        return { success: true };
    } catch (error) {
        console.error("Error deleting file from R3:", error);
        throw error;
    }
};

/**
 * Get a presigned URL to view/download a file
 */
const getFileUrl = async (fileName, expiresIn = 3600) => {
    const params = {
        Bucket: BUCKET_NAME,
        Key: fileName,
    };

    try {
        const command = new GetObjectCommand(params);
        const url = await getSignedUrl(s3Client, command, { expiresIn });
        return url;
    } catch (error) {
        console.error("Error generating presigned URL:", error);
        throw error;
    }
};

module.exports = {
    s3Client,
    uploadFile,
    deleteFile,
    getFileUrl
};
