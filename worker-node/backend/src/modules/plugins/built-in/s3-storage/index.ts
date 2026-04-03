let s3Sdk: any = null;
let s3Presigner: any = null;
function getS3() {
  if (!s3Sdk) { s3Sdk = require('@aws-sdk/client-s3'); }
  if (!s3Presigner) { s3Presigner = require('@aws-sdk/s3-request-presigner'); }
  return { ...s3Sdk, getSignedUrl: s3Presigner.getSignedUrl };
}

interface S3Config {
  bucket: string;
  region: string;
  access_key: string;
  secret_key: string;
  endpoint?: string;
}

export class S3StoragePlugin {
  private getClient(config: S3Config): any {
    const { S3Client } = getS3();
    const clientConfig: Record<string, unknown> = {
      region: config.region,
      credentials: {
        accessKeyId: config.access_key,
        secretAccessKey: config.secret_key,
      },
    };

    if (config.endpoint) {
      clientConfig.endpoint = config.endpoint;
      clientConfig.forcePathStyle = true;
    }

    return new S3Client(clientConfig);
  }

  async upload(config: S3Config, key: string, body: Buffer | string, contentType?: string) {
    const client = this.getClient(config);
    const command = new (getS3().PutObjectCommand)({
      Bucket: config.bucket,
      Key: key,
      Body: typeof body === 'string' ? Buffer.from(body) : body,
      ContentType: contentType ?? 'application/octet-stream',
    });

    await client.send(command);
    return { key, bucket: config.bucket };
  }

  async download(config: S3Config, key: string) {
    const client = this.getClient(config);
    const command = new (getS3().GetObjectCommand)({
      Bucket: config.bucket,
      Key: key,
    });

    const response = await client.send(command);
    const stream = response.Body;
    if (!stream) throw new Error('No body in S3 response');

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return {
      body: Buffer.concat(chunks),
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  }

  async delete(config: S3Config, key: string) {
    const client = this.getClient(config);
    const command = new (getS3().DeleteObjectCommand)({
      Bucket: config.bucket,
      Key: key,
    });

    await client.send(command);
    return { deleted: true, key };
  }

  async getSignedUploadUrl(config: S3Config, key: string, contentType?: string, expiresIn = 3600) {
    const client = this.getClient(config);
    const command = new (getS3().PutObjectCommand)({
      Bucket: config.bucket,
      Key: key,
      ContentType: contentType ?? 'application/octet-stream',
    });

    const url = await getS3().getSignedUrl(client, command, { expiresIn });
    return { url, key, expiresIn };
  }
}
