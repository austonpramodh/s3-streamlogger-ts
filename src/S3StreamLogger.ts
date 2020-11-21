import * as os from "os";
import { Writable } from "stream";
import * as zlib from "zlib";

import { S3, Credentials } from "aws-sdk";
import * as dayjs from "dayjs";
import * as utc from "dayjs/plugin/utc";

dayjs.extend(utc);

interface S3StreamLoggerOptions {
    /**
     * AWS access key ID.
     */
    accessKeyId: Credentials["accessKeyId"];
    /**
     * AWS secret access key.
     */
    secretAccessKey: Credentials["secretAccessKey"];
    /**
     * The endpoint URI to send requests to. The default endpoint is built from the configured region.
     * The endpoint should be a string like 'https://{service}.{region}.amazonaws.com' or an Endpoint object.
     */
    endpoint?: S3["config"]["endpoint"];
    /**
     * Whether SSL is enabled for requests.
     */
    sslEnabled?: S3["config"]["sslEnabled"];
    /**
     * The region to send service requests to.
     */
    region?: S3["config"]["region"];
    /**
     * Whether the provided endpoint addresses an individual bucket.
     * false if it addresses the root API endpoint.
     */
    s3BucketEndpoint?: S3["config"]["s3BucketEndpoint"];
    /**
     * The s3 bucket name
     */
    bucket: string;
    /**
     * Folder to be apended in the key of the log
     */
    folder?: string;
    /**
     * Environment for Formatting file Name
     * ie: `YYYY-MMM-DD-HH-mm-environment-win32.log.gz`;
     * defaults to NODE_ENV
     */
    environment?: string;
    /**
     * DayJS Formatting text
     */
    nameFormat?: string;
    // max_file_size: string;
    /**
     * Number in ms
     * Default: 20*1000 = 20 seconds
     */
    uploadDelay?: number;
    /**
     * Number in bytes
     * Default: 10*1000 = 10kb
     */
    bufferSize?: number;
    /**
     * serverSideEncryption for S3
     */
    serverSideEncryption?: S3.PutObjectRequest["ServerSideEncryption"];
    /**
     * acl for S3
     */
    acl?: S3.PutObjectRequest["ACL"];
    /**
     * Enable compression of the logs
     */
    compress?: boolean;
    /**
     * default to 60 minutes
     */
    rotateEvery?: number;
    /**
     * Number in bytes
     * defaults to 200 * 1000 = 200kb
     */
    maxFileSize?: number;
    /**
     * storageClass for S3
     */
    storageClass?: S3.PutObjectRequest["StorageClass"];
    /**
     * Container for the TagSet and Tag elements
     */
    tags?: Record<string, string>;
    /**
     * Should save logs in JSON format
     */
    saveLogsInJSON?: boolean;
}

export class S3StreamLogger extends Writable {
    private s3: S3;
    private flushTimeout: NodeJS.Timeout | null = null;
    private fileCreatedAt!: Date; // defined in initializer function
    private lastFileWrittenAt!: Date;
    private buffers!: Buffer[];
    private fileName!: string;
    private unwritten = 0;
    private folder: string | undefined;
    private nameFormat: string;
    private environment: string;
    private uploadDelay: number;
    private bufferSize: number;
    private compress: boolean;
    private rotateEvery: number;
    private bucket: string;
    private maxFileSize: number;
    private storageClass?: S3.PutObjectRequest["StorageClass"];
    private serverSideEncryption: S3.PutObjectRequest["ServerSideEncryption"];
    private acl: S3.PutObjectRequest["ACL"];
    private tags: Record<string, string>;
    private saveLogsInJSON: boolean;

    public constructor(options: S3StreamLoggerOptions) {
        super();

        this.s3 = new S3({
            credentials: {
                accessKeyId: options.accessKeyId,
                secretAccessKey: options.secretAccessKey,
            },
            s3BucketEndpoint: options.s3BucketEndpoint,
            endpoint: options.endpoint,
            sslEnabled: options.sslEnabled,
            region: options.region,
        });

        this.folder = options.folder;
        this.bucket = options.bucket;
        this.storageClass = options.storageClass;
        this.tags = options.tags || {};
        this.uploadDelay = options.uploadDelay || 20 * 1000; // default to 20 seconds
        this.bufferSize = options.bufferSize || 10000; // or every 10k, which ever is sooner
        this.serverSideEncryption = options.serverSideEncryption;
        this.acl = options.acl;
        this.compress = options.compress || false;
        this.rotateEvery = options.rotateEvery || 60 * 60 * 1000; // default to 60 minutes
        this.maxFileSize = options.maxFileSize || 200 * 1000; // or 200k, whichever is sooner

        this.environment = options.environment || process.env.NODE_ENV || "development";

        this.saveLogsInJSON = options.saveLogsInJSON || false;

        this.nameFormat =
            options.nameFormat ||
            `YYYY-MMM-DD-HH-mm-${this.environment}-${os.hostname()}${this.saveLogsInJSON ? ".json" : ".log"}${
                this.compress ? ".gz" : ""
            }`;

        //Initialize
        this.newFile();
    }

    /**
     * _newFile should ONLY be called when there is no un-uploaded data (i.e.
     * from _upload or initialization), otherwise data will be lost.
     */
    private newFile(): string {
        this.buffers = [];
        this.fileCreatedAt = new Date();
        this.lastFileWrittenAt = this.fileCreatedAt;

        // make sure there aren't multiple trailing slashes on the folder name.
        const folder = (this.folder ? this.folder + "/" : "").replace(/\/+$/, "/");

        const fileName = folder + dayjs.utc(this.fileCreatedAt).format(this.nameFormat);

        this.fileName = fileName;

        return fileName;
    }

    public _write(chunk: string | Buffer, encoding: BufferEncoding, callback?: (error: Error | null) => void): void {
        if (typeof chunk === "string") chunk = Buffer.from(chunk, encoding);

        //cache the chunk for flushing it at one shot
        if (chunk) {
            this.buffers.push(chunk);
            this.unwritten += chunk.length;
        }

        //Reset the timer is already written
        if (this.flushTimeout) {
            clearTimeout(this.flushTimeout);
            this.flushTimeout = null;
        }

        //check if its time to flush or not
        if (
            !this.lastFileWrittenAt ||
            new Date().getTime() - this.lastFileWrittenAt?.getTime() > this.uploadDelay ||
            this.unwritten > this.bufferSize
        ) {
            this.upload();
        } else {
            // if not set a timout
            this.flushTimeout = setTimeout(() => this.upload(), this.uploadDelay);
        }

        // Call the callback immediately, as we may not actually write for some
        // time. If there is an upload error, we trigger our 'error' event.
        if (callback && typeof callback === "function") setImmediate(callback);
    }

    private fileSize(): number {
        return this.buffers
            .map((buffer) => buffer.length)
            .reduce((accumulativeValue, currentValue) => accumulativeValue + currentValue, 0);
    }

    private prepareBuffer(): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            let buffer: Buffer;

            if (this.saveLogsInJSON) {
                const buffers: unknown[] = [];

                this.buffers.forEach((eachBuffer) => {
                    try {
                        buffers.push(JSON.parse(eachBuffer.toString()));
                    } catch (error) {
                        buffers.push(eachBuffer.toString());
                    }
                });

                buffer = Buffer.from(JSON.stringify(buffers));
            } else {
                buffer = Buffer.concat(this.buffers);
            }

            if (this.compress) {
                zlib.gzip(buffer, (error, result) => {
                    if (error) {
                        reject(error);

                        return;
                    }

                    resolve(result);
                });

                return;
            }
            resolve(buffer);
        });
    }

    private restoreUnwritten(unwritten: number, fileName: string, buffers: Buffer[]): void {
        // If no data was erased, then only the unwritten counter needs correcting:
        this.unwritten += unwritten;
        // If there is data to restore, then switch back to the previous filename
        // and restore it:
        if (buffers.length > 0) {
            this.buffers = buffers.concat(this.buffers);
            this.fileName = fileName;
        }
    }

    private async putObject(param: S3.PutObjectRequest): Promise<S3.PutObjectOutput> {
        return this.s3.putObject(param).promise();
    }

    private getTags(): string | undefined {
        if (Object.keys(this.tags).length === 0) return;

        // constructc the tagging string according to AWS SDK specifications
        const tagging = Object.keys(this.tags || {})
            .map((key) => `${key}=${this.tags[key]}`)
            .join("&");

        return tagging;
    }

    public async upload(
        forceNewFile = false,
        callback?: (error?: Error | null, data?: S3.Types.PutObjectOutput) => void,
    ): Promise<boolean> {
        //clear the flushing timeout
        if (this.flushTimeout) {
            clearTimeout(this.flushTimeout);
            this.flushTimeout = null;
        }

        //update lastFileWrittenTime
        this.lastFileWrittenAt = new Date();

        const savedState: {
            buffers: Buffer[];
            unwritten: number;
            fileName: string;
        } = {
            buffers: [],
            unwritten: this.unwritten,
            fileName: this.fileName,
        };

        // if we're erasing the data, then take a temporary copy of it until we
        // know the upload has succeeded. If it fails (either due to compression or
        // upload failure) we will re-instate it:

        this.unwritten = 0;
        const elapsed = new Date().getTime() - this.fileCreatedAt.getTime();
        let resetBuffers = false;

        // Decide if the current file has to be closed from being appending more logs
        if (forceNewFile || elapsed > this.rotateEvery || this.fileSize() > this.maxFileSize) {
            savedState.buffers = this.buffers;
            resetBuffers = true;
        }

        try {
            const preparedBuffer = await this.prepareBuffer();
            const params: S3.PutObjectRequest = {
                Bucket: this.bucket,
                Key: this.fileName,
                Body: preparedBuffer,
                Tagging: this.getTags(),
                StorageClass: this.storageClass,
                ServerSideEncryption: this.serverSideEncryption,
                ACL: this.acl,
                // Setting content type to text/plain allows log files to be
                // previewed natively within browsers without downloading.
                ContentType: this.compress ? undefined : "text/plain",
            };

            const putObjectResult = await this.putObject(params);

            if (callback) {
                callback(null, putObjectResult);
            }

            if (resetBuffers) {
                this.newFile();
            }

            return true;
        } catch (error) {
            //TODO: Handle error
            this.restoreUnwritten(savedState.unwritten, savedState.fileName, savedState.buffers);
            if (callback) {
                callback(error);
            }

            return false;
        }
    }

    public flushFile(callback?: (error?: Error | null, data?: S3.Types.PutObjectOutput) => void): void {
        this.upload(true, callback);
    }

    public _final(callback: (error?: Error | null, data?: S3.Types.PutObjectOutput) => void): void {
        this.upload(false, callback);
    }
}
