import { AwsS3Client } from "./adapters/aws-sdk-clients.js";
import { OtpGroundRouteProvider } from "./adapters/otp-ground-route-provider.js";
import { createOtpRouteBridgeHandler } from "./adapters/otp-route-bridge-handler.js";
import { S3OtpGraphManifestRepository } from "./adapters/s3-otp-graph-manifest-repository.js";

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error("Missing OTP bridge configuration"); return value; };
const endpoint = required("OTP_GRAPHQL_ENDPOINT");
if (!/^http:\/\/otp\.[a-z0-9.-]+:8080\/otp\/gtfs\/v1$/u.test(endpoint)) throw new Error("Invalid private OTP endpoint");
const repository = new S3OtpGraphManifestRepository(new AwsS3Client(), required("OTP_GRAPH_BUCKET"),
  required("OTP_GRAPH_MANIFEST_KEY"), required("OTP_GRAPH_VERSION"), required("OTP_EXPECTED_IMAGE"), required("OTP_EXPECTED_GRAPH_SHA"), process.env.OTP_REGION_ID || "izumo-matsue");
export const handler = createOtpRouteBridgeHandler(repository, coverage => new OtpGroundRouteProvider(endpoint, coverage));
