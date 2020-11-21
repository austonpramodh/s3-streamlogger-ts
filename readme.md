### This respository is based on [s3-streamlogger](https://github.com/Coggle/s3-streamlogger).

## s3-streamlogger-ts
[![npm version](https://badge.fury.io/js/%40austonpramodh%2Fs3-streamlogger-ts.svg)](https://badge.fury.io/js/%40austonpramodh%2Fs3-streamlogger-ts)


A Writable Stream object that uploads to s3 objects, periodically rotating to a
new object name.


### Installation
```bash
npm install --save @austonpramodh/s3-streamlogger-ts
```

### Basic Usage
```js
import { S3StreamLogger } from "@austonpramodh/s3-streamlogger-ts";

const s3stream = new S3StreamLogger({
    bucket: "mys3bucket",
    accessKeyId: "...",
    secretAccessKey: "..."
});

s3stream.write("hello S3");
```

### Use with Winston: Log to S3
```sh
npm install --save winston
npm install --save @austonpramodh/s3-streamlogger-ts
```

```js
import { transports, createLogger } from "winston";
import { S3StreamLogger } from "@austonpramodh/s3-streamlogger-ts";

const s3stream = new S3StreamLogger({
    bucket: "mys3bucket",
    accessKeyId: "...",
    secretAccessKey: "..."
});

const transport = new transports.Stream({ stream: s3_stream })

// see error handling section below
transport.on('error', function(err){/* ... */});

const logger = createLogger({
  transports: [transport]
});

logger.info('Hello Winston!');
```


### Define subfolder
```js
import { S3StreamLogger } from "@austonpramodh/s3-streamlogger-ts";

const s3stream = new S3StreamLogger({
    bucket: "mys3bucket",
    accessKeyId: "...",
    secretAccessKey: "...",
    folder: "my/nested/subfolder"
});

s3stream.write("hello S3");
```

### Assign tags
```js
import { S3StreamLogger } from "@austonpramodh/s3-streamlogger-ts";

const s3stream = new S3StreamLogger({
    bucket: "mys3bucket",
    accessKeyId: "...",
    secretAccessKey: "...",
    folder: "my/nested/subfolder",
    tags: {type: 'myType', project: 'myProject'},
});

s3stream.write("hello S3");
```

### Handling logging errors
When there is an error writing to s3, the stream emits an 'error' event with
details. You should take care **not** to log these errors back to the same
stream (as that is likely to cause infinite recursion). Instead log them to the
console, to a file.

Note that these errors will result in uncaught exceptions unless you have an
`error` event handler registered, for example:

```js
s3stream.on('error', function(err){
    // there was an error!
    some_other_logging_transport.log('error', 'logging transport error', err)
});
```

When using s3-streamlogger with the Winston Stream transport, the Stream transport
attaches its own error handler to the stream, so you do not need your own,
however it will re-emit the errors on itself which must be handled instead:

```js
const transport = new transports.Stream({ stream: s3_stream })

transport.on('error', function(err){
  /* handle s3 stream errors (e.g. invalid credentials, EHOSTDOWN) here */
});

const logger = createLogger({
  transports: [transport]
});
```

### Options

#### bucket *(required)*
Name of the S3 bucket to upload data to. Must exist.
Can also be provided as the environment variable `BUCKET_NAME`.

#### folder
An optional folder to stream log files to. Takes a path string,
eg: "my/subfolder" or "nested".

#### tags
An optional set of tags to assign to the log files. Takes an object,
eg: `{type: "myType"}` or `{type: "myType", project: "myProject"}`.

#### access_key_id
AWS access key ID, must have putObject permission on the specified bucket.  Can
also be provided as the environment variable `AWS_SECRET_ACCESS_KEY`, or as any
of the other [authentication
methods](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html)
supported by the AWS SDK.

#### secret_access_key
AWS secret key for the `access_key_id` specified.  Can also be provided as the
environment variable `AWS_SECRET_KEY_ID`, or as any of the other
[authentication
methods](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html)
supported by the AWS SDK.

#### config

Configuration object for the AWS SDK. The full list of options is available on the [AWS SDK Configuration Object page](http://docs.aws.amazon.com/AWSJavaScriptSDK/guide/node-configuring.html). This is an alternative to using access_key_id and secret_access_key and is overwritten by them if both are used.

#### name_format
Format of file names to create, accepts [strftime specifiers](https://github.com/samsonjs/strftime). Defaults to `"YYYY-MMM-DD-HH-mm-<NODE_ENV>-<hostname>.log"`. The Date() used to fill the format specifiers is created with the current UTC time, but still *has the current timezone*, so any specifiers that perform timezone conversion will return incorrect dates.

If `compress` is set to true, then the default extension is `.log.gz` instead of
`.log`.

#### rotate_every
Files will be rotated every `rotate_every` milliseconds. Defaults to 3600000 (60
minutes).

#### max_file_size
Files will be rotated when they reach `maxFileSize` bytes. Defaults to 200 KB.

#### uploadDelay
Files will be uploaded every `uploadDelay` milliseconds. Defaults to 20
seconds.

#### bufferSize
Files will be uploaded if the un-uploaded data exceeds `bufferSize` bytes.
Defaults to 10 KB.

#### serverSideEncryption
The server side encryption `AES256` algorithm used when storing objects in S3.
Defaults to false.

#### storageClass
The S3 StorageClass (STANDARD, REDUCED_REDUNDANCY, etc.). If omitted, no value
is used and aws-sdk will fill in its default.

#### acl
The canned ACL (access control list) to apply to uploaded objects.
Defaults to no ACL.

#### compress
If true, the files will be gzipped before uploading (may reduce s3 storage costs).
Defaults to false.

### License
<!-- [ISC](http://opensource.org/licenses/ISC): equivalent to 2-clause BSD. -->
UNLICENSED

