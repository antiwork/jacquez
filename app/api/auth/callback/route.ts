import { NextRequest, NextResponse } from "next/server";

const GH_CLIENT_ID = process.env.GH_CLIENT_ID || "Iv23li7lc1AzCTzvjCjz";
const GH_CLIENT_SECRET = process.env.GH_CLIENT_SECRET;

if (!GH_CLIENT_SECRET) {
  throw new Error("GH_CLIENT_SECRET is required");
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  // Handle OAuth errors
  if (error) {
    const errorDescription = searchParams.get("error_description");
    console.error("OAuth error:", error, errorDescription);
    return NextResponse.redirect(new URL("/?error=oauth_error", request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL("/?error=missing_code", request.url));
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: GH_CLIENT_ID,
          client_secret: GH_CLIENT_SECRET,
          code,
          state,
        }),
      }
    );

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error(
        "Token exchange error:",
        tokenData.error,
        tokenData.error_description
      );
      return NextResponse.redirect(
        new URL("/?error=token_exchange_failed", request.url)
      );
    }

    // Get user info
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!userResponse.ok) {
      console.error(
        "Failed to fetch user info:",
        userResponse.status,
        userResponse.statusText
      );
      return NextResponse.redirect(
        new URL("/?error=user_fetch_failed", request.url)
      );
    }

    const userData = await userResponse.json();

    // Create response and set secure cookies
    const response = NextResponse.redirect(new URL("/repository", request.url));

    // Set secure cookies
    response.cookies.set("github_access_token", tokenData.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    response.cookies.set(
      "github_user",
      JSON.stringify({
        id: userData.id,
        login: userData.login,
        name: userData.name,
        email: userData.email,
        avatar_url: userData.avatar_url,
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: "/",
      }
    );

    return response;
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(
      new URL("/?error=callback_failed", request.url)
    );
  }
}
