/**
 * Contains shared utilities that are reused for the Next.js API (backend)
 */
import { JwtConfig } from "./types";
import * as jose from "jose";
import crypto, { randomUUID } from "crypto";
import { NextApiRequest, NextApiResponse } from "next";

const JWK_ALG = "PS256";

/**
 * Generates a 1-min JWT for the `service` role (only for internal use from Next.js API)
 * @returns
 */
export const generateServiceJWT = async (): Promise<string> => {
  const JWT_CONFIG: JwtConfig = JSON.parse(
    process.env.HASURA_GRAPHQL_JWT_SECRET || ""
  );

  if (!JWT_CONFIG) {
    throw "Improperly configured. `HASURA_GRAPHQL_JWT_SECRET` env var must be set!";
  }

  const payload = {
    sub: "service_account",
    "https://hasura.io/jwt/claims": {
      "x-hasura-allowed-roles": ["service"],
      "x-hasura-default-role": "service",
    },
  };

  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_CONFIG.type })
    .setIssuer("https://developer.worldcoin.org")
    .setExpirationTime("1m")
    .sign(Buffer.from(JWT_CONFIG.key));

  return token;
};

/**
 * Generates a JWT for a specific user.
 */
const _generateJWT = async (
  payload: Record<string, any>,
  expiration: string = "24h"
): Promise<string> => {
  const JWT_CONFIG: JwtConfig = JSON.parse(
    process.env.HASURA_GRAPHQL_JWT_SECRET || ""
  );

  if (!JWT_CONFIG) {
    throw "Improperly configured. `HASURA_GRAPHQL_JWT_SECRET` env var must be set!";
  }

  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_CONFIG.type })
    .setIssuer("https://developer.worldcoin.org")
    .setExpirationTime(expiration)
    .sign(Buffer.from(JWT_CONFIG.key));

  return token;
};

/**
 * Generates a JWT for a specific user.
 * @param user_id
 * @param team_id
 * @returns
 */
export const generateUserJWT = async (
  user_id: string,
  team_id: string
): Promise<string> => {
  const payload = {
    sub: user_id,
    "https://hasura.io/jwt/claims": {
      "x-hasura-allowed-roles": ["user"],
      "x-hasura-default-role": "user",
      "x-hasura-user-id": user_id,
      "x-hasura-team-id": team_id,
    },
  };

  return await _generateJWT(payload);
};

/**
 * Generates a JWT for a specific API key.
 * @param team_id
 * @returns
 */
export const generateAPIKeyJWT = async (team_id: string): Promise<string> => {
  const payload = {
    sub: team_id,
    "https://hasura.io/jwt/claims": {
      "x-hasura-allowed-roles": ["api_key"],
      "x-hasura-default-role": "api_key",
      "x-hasura-team-id": team_id,
    },
  };

  return await _generateJWT(payload);
};

/**
 * Generates a secure password hash to store in the DB
 * @param rawPassword
 * @param salt (optional), if a specific salt should be used (e.g. when verifying passwords), if empty, a salt will be generated
 * @returns
 */
export const generatePassword = (
  rawPassword: string,
  salt: string = ""
): string => {
  salt = salt || crypto.randomBytes(16).toString("hex");

  const hashedPwd = crypto
    .pbkdf2Sync(rawPassword, salt, 50_000, 256, `sha512`)
    .toString(`hex`);

  return `${salt}@${hashedPwd}`;
};

/**
 * Generates an asymmetric key pair in JWK format
 * @returns
 */
export const generateJWK = async (): Promise<{
  privateJwk: jose.JWK;
  publicJwk: jose.JWK;
}> => {
  const { publicKey, privateKey } = await jose.generateKeyPair(JWK_ALG);

  const privateJwk = await jose.exportJWK(privateKey);
  const publicJwk = await jose.exportJWK(publicKey);

  return { privateJwk, publicJwk };
};

/**
 * Generates a JWT that can be used to verify a proof through the hosted page
 * @param privateJwk JWK to use for token signature
 * @param payload Payload for the JWT
 * @returns
 */
export const generateVerificationJWT = async (
  privateJwk: jose.JWK,
  kid: string,
  signal: string,
  nullifier_hash: string
): Promise<string> => {
  const payload = {
    signal,
    nullifier_hash,
    verified: true,
    jti: randomUUID(),
  };

  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWK_ALG, kid })
    .setIssuer("https://developer.worldcoin.org")
    .setExpirationTime("1h")
    .sign(await jose.importJWK(privateJwk, JWK_ALG));
};

/**
 * Ensures endpoint is properly authenticated using internal token. For interactions between Hasura -> Next.js API
 * @param req
 * @param res
 * @returns
 */
export const protectInternalEndpoint = (
  req: NextApiRequest,
  res: NextApiResponse
): boolean => {
  if (
    !process.env.INTERNAL_ENDPOINTS_SECRET ||
    req.headers.authorization?.replace("Bearer ", "") !==
      process.env.INTERNAL_ENDPOINTS_SECRET
  ) {
    res.status(403).json({
      code: "permission_denied",
      detail: "You do not have permission to perform this action.",
      attr: null,
    });
    return false;
  }
  return true;
};

/**
 * Checks whether the person can be verified for a particular action based on the max number of verifications
 */
export const canVerifyForAction = (
  nullifiers: Array<{
    nullifier_hash: string;
  }>,
  max_verifications_per_person: number
): boolean => {
  if (!nullifiers.length) {
    // Person has not verified before, can always verify for the first time
    return true;
  } else if (max_verifications_per_person <= 0) {
    // `0` or `-1` means unlimited verifications
    return true;
  }

  // Else, can only verify if the max number of verifications has not been met
  return nullifiers.length < max_verifications_per_person;
};