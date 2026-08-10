import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { uuidv7 } from "../../../common/utils/uuidv7";
import { JwksService } from "./jwks.service";

// PRD §17.4 doesn't give an exact iss/aud string, only that both claims
// must be present — these are a reasonable, stable choice, not a
// transcription.
const ISSUER = "https://api.convene.app";
const AUDIENCE = "https://api.convene.app";
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export interface AccessTokenClaims {
  sub: string;
  role: string;
  plan: string;
  /** token_version — bumped on refresh-reuse detection to invalidate every outstanding access token (§17.4). */
  tv: number;
}

export interface DecodedAccessToken extends AccessTokenClaims {
  iat: number;
  exp: number;
  jti: string;
  aud: string;
  iss: string;
  typ: "access";
}

export interface RefreshTokenPair {
  /** The raw, opaque token — given to the client, never stored. */
  token: string;
  /** SHA-256 hex digest — what's actually persisted (§17.4/§20.4: "never recoverable"). */
  hash: string;
}

// PRD §17.4 / P5.1, translated faithfully: RS256 access tokens carrying
// sub/role/plan/tv/iat/exp/jti/aud/iss, verified against whichever of the
// current/previous public keys (jwks.service.ts) matches the token's own
// `kid` header — this is exactly what lets a token signed before a
// rotation keep validating after it. Refresh tokens are opaque 256-bit
// random values; only their SHA-256 hash is ever persisted.
@Injectable()
export class TokenService {
  constructor(private readonly jwks: JwksService) {}

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    const { kid, privateKeyPem } = await this.jwks.getSigningKey();
    return jwt.sign(
      { typ: "access", role: claims.role, plan: claims.plan, tv: claims.tv },
      privateKeyPem,
      {
        algorithm: "RS256",
        subject: claims.sub,
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        jwtid: uuidv7(),
        audience: AUDIENCE,
        issuer: ISSUER,
        keyid: kid,
      },
    );
  }

  async verifyAccessToken(token: string): Promise<DecodedAccessToken> {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === "string") {
      throw new Error("TokenService: malformed access token");
    }

    const kid = decoded.header.kid;
    const verificationKeys = await this.jwks.getVerificationKeys();
    const matchingKey = verificationKeys.find((key) => key.kid === kid);
    if (!matchingKey) {
      throw new Error("TokenService: no verification key matches this token's kid (rotated out?)");
    }

    const payload = jwt.verify(token, matchingKey.publicKeyPem, {
      algorithms: ["RS256"],
      audience: AUDIENCE,
      issuer: ISSUER,
    });
    if (typeof payload === "string") {
      throw new Error("TokenService: unexpected string payload");
    }
    // P11.1: WS tickets (ticket.service.ts, apps/realtime) are also RS256
    // tokens signed by this same KMS key, but carry typ:"ws_ticket" and no
    // role/plan/tv — this guard is defense-in-depth against one ever being
    // presented as a Bearer access token (JwtAuthGuard's tv comparison
    // would already reject it, since a ticket's tv is undefined, but an
    // explicit type check is clearer than relying on that side effect).
    if ((payload as { typ?: string }).typ !== "access") {
      throw new Error("TokenService: not an access token");
    }
    return payload as unknown as DecodedAccessToken;
  }

  generateRefreshToken(): RefreshTokenPair {
    const token = randomBytes(32).toString("base64url");
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }
}
