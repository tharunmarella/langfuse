/**
 * MongoDB GridFS Storage Service
 *
 * Implements StorageService interface using MongoDB GridFS as an alternative to S3.
 * GridFS stores files as chunks in MongoDB collections, suitable for small-scale deployments.
 *
 * Usage: Set LANGFUSE_USE_MONGODB_STORAGE="true" to enable MongoDB storage instead of S3.
 */

import { Readable } from "stream";
import { MongoClient, GridFSBucket, Db } from "mongodb";
import { logger } from "../logger";
import { StorageService } from "./StorageService";

export class MongoDBStorageService implements StorageService {
  private client: MongoClient;
  private db: Db;
  private bucket: GridFSBucket;
  private bucketName: string;
  private connectionString: string;
  private databaseName: string;

  constructor(params: {
    connectionString: string;
    databaseName?: string;
    bucketName: string;
  }) {
    this.connectionString = params.connectionString;
    this.databaseName = params.databaseName || "langfuse_storage";
    this.bucketName = params.bucketName;

    // Initialize MongoDB client (lazy connection on first use)
    this.client = new MongoClient(this.connectionString);
    this.db = this.client.db(this.databaseName);
    this.bucket = new GridFSBucket(this.db, {
      bucketName: this.bucketName,
    });
  }

  private async ensureConnected(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      logger.error("Failed to connect to MongoDB for storage", error);
      throw error;
    }
  }

  async uploadFile(params: {
    fileName: string;
    fileType: string;
    data: Readable | string;
  }): Promise<void> {
    await this.ensureConnected();

    const uploadStream = this.bucket.openUploadStream(params.fileName, {
      metadata: {
        contentType: params.fileType,
        uploadedAt: new Date(),
      },
    });

    return new Promise((resolve, reject) => {
      if (typeof params.data === "string") {
        // Convert string to stream
        const readable = Readable.from([params.data]);
        readable.pipe(uploadStream);
      } else {
        params.data.pipe(uploadStream);
      }

      uploadStream.on("finish", () => {
        logger.debug(`Uploaded file to MongoDB GridFS: ${params.fileName}`);
        resolve();
      });

      uploadStream.on("error", (error) => {
        logger.error(
          `Failed to upload file to MongoDB: ${params.fileName}`,
          error,
        );
        reject(error);
      });
    });
  }

  async uploadWithSignedUrl(params: {
    fileName: string;
    fileType: string;
    data: Readable | string;
    expiresInSeconds: number;
  }): Promise<{ signedUrl: string }> {
    // MongoDB GridFS doesn't support signed URLs directly
    // Upload the file and return a dummy URL
    await this.uploadFile(params);
    return {
      signedUrl: `mongodb://${this.bucketName}/${params.fileName}`,
    };
  }

  async uploadJson(
    path: string,
    body: Record<string, unknown>[] | Record<string, unknown>,
  ): Promise<void> {
    const jsonString = JSON.stringify(body);
    await this.uploadFile({
      fileName: path,
      fileType: "application/json",
      data: jsonString,
    });
  }

  async download(path: string): Promise<string> {
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      const downloadStream = this.bucket.openDownloadStreamByName(path);
      const chunks: Buffer[] = [];

      downloadStream.on("data", (chunk) => {
        chunks.push(chunk);
      });

      downloadStream.on("end", () => {
        const content = Buffer.concat(chunks).toString("utf-8");
        resolve(content);
      });

      downloadStream.on("error", (error) => {
        logger.error(`Failed to download file from MongoDB: ${path}`, error);
        reject(error);
      });
    });
  }

  async listFiles(
    prefix: string,
  ): Promise<{ file: string; createdAt: Date }[]> {
    await this.ensureConnected();

    const files = await this.bucket
      .find({
        filename: { $regex: `^${prefix}` },
      })
      .toArray();

    return files.map((file) => ({
      file: file.filename,
      createdAt: file.uploadDate,
    }));
  }

  async getSignedUrl(
    fileName: string,
    _ttlSeconds: number,
    _asAttachment?: boolean,
  ): Promise<string> {
    // MongoDB GridFS doesn't support signed URLs
    // Return a placeholder URL
    return `mongodb://${this.bucketName}/${fileName}`;
  }

  async getSignedUploadUrl(params: {
    path: string;
    ttlSeconds: number;
    sha256Hash: string;
    contentType: string;
    contentLength: number;
  }): Promise<string> {
    // MongoDB GridFS doesn't support pre-signed upload URLs
    // Return a placeholder URL
    return `mongodb://${this.bucketName}/${params.path}`;
  }

  async deleteFiles(paths: string[]): Promise<void> {
    await this.ensureConnected();

    for (const path of paths) {
      try {
        const files = await this.bucket.find({ filename: path }).toArray();
        for (const file of files) {
          await this.bucket.delete(file._id);
        }
        logger.debug(`Deleted file from MongoDB GridFS: ${path}`);
      } catch (error) {
        logger.error(`Failed to delete file from MongoDB: ${path}`, error);
        // Continue with other files even if one fails
      }
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
