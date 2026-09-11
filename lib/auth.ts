import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export function getJwtSecret(): string {
  const secret = process.env["JWT_SECRET"];
  if (!secret) {
    throw new Error("Missing required environment variable: JWT_SECRET");
  }
  return secret;
}

const JWT_EXPIRES_IN = "30d";

export interface JWTPayload {
  userId: string;
  email: string;
  role: "user" | "admin";
  isDemo?: boolean;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: JWTPayload): string {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JWTPayload;
  } catch (err) {
    return null;
  }
}

export function getAuthUserFromRequest(req: Request): JWTPayload | null {
  // Check Authorization header: Bearer <token>
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    return verifyToken(token);
  }

  // Also check Cookie header
  const cookieHeader = req.headers.get("cookie");
  if (cookieHeader) {
    const match = cookieHeader.match(/smarta_token=([^;]+)/);
    if (match && match[1]) {
      return verifyToken(match[1]);
    }
  }

  return null;
}
