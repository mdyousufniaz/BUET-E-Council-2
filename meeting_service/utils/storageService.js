const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
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
const uploadFile = async (fileBuffer, fileName, mimeType, metadata) => {
    const params = {
        Bucket: BUCKET_NAME,
        Key: fileName,
        Body: fileBuffer,
        ContentType: mimeType,
    };

    // Optional user metadata (e.g. a cache fingerprint). Values must be strings.
    if (metadata) {
        params.Metadata = metadata;
    }

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
 * Download a file's contents as a Buffer.
 */
const getFileBuffer = async (fileName) => {
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: fileName });
    const response = await s3Client.send(command);
    const byteArray = await response.Body.transformToByteArray();
    return Buffer.from(byteArray);
};

/**
 * Fetch an object's user metadata without downloading its body.
 * Returns the metadata object, or null if the object does not exist.
 */
const getFileMetadata = async (fileName) => {
    try {
        const command = new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: fileName });
        const response = await s3Client.send(command);
        return response.Metadata || {};
    } catch (error) {
        const status = error.$metadata && error.$metadata.httpStatusCode;
        if (error.name === 'NotFound' || error.name === 'NoSuchKey' || status === 404) {
            return null;
        }
        throw error;
    }
};

/**
 * List files under a key prefix (e.g. "audit-log-archives/"), newest first.
 */
const listFiles = async (prefix) => {
    const command = new ListObjectsV2Command({ Bucket: BUCKET_NAME, Prefix: prefix });
    const response = await s3Client.send(command);
    return (response.Contents || [])
        .map(obj => ({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified }))
        .sort((a, b) => new Date(b.lastModified) - new Date(a.lastModified));
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
 * Get a live object stream (and its content type) for proxying through our own server,
 * so file access can be gated behind our auth middleware instead of exposed directly.
 */
const getFileStream = async (fileName) => {
    const command = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: fileName });
    const response = await s3Client.send(command);
    return {
        stream: response.Body,
        contentType: response.ContentType || 'application/octet-stream',
        contentLength: response.ContentLength
    };
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
    getFileUrl,
    getFileBuffer,
    getFileMetadata,
    getFileStream,
    listFiles
};
