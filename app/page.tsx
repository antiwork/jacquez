"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Github } from "lucide-react";
import { GithubCommentDemo } from "@/components/github-comment-demo";
import { useAuth } from "@/lib/auth";

export default function JacquezLandingPage() {
  const { isAuthenticated, loading } = useAuth();

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
      window.location.href = "/";
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  return (
    <div className="flex flex-col min-h-dvh bg-gray-100 dark:bg-black text-black dark:text-white">
      <main className="flex-1 flex items-center">
        <div className="container mx-auto px-0 md:px-6 pt-10 md:pt-0">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="flex flex-col space-y-6 text-left justify-center px-6 md:px-0">
              <div className="space-y-4">
                <h1 className="font-bold tracking-tighter text-5xl xl:text-6xl/none flex items-center gap-2">
                  <svg
                    width="64"
                    height="64"
                    viewBox="0 0 32 32"
                    fill="none"
                    aria-hidden="true"
                    className="inline-block"
                  >
                    <polygon points="4,28 28,28 28,4" fill="currentColor" />
                  </svg>
                  Jacquez
                </h1>
                <p className="max-w-[600px] text-gray-600 dark:text-gray-300 md:text-xl">
                  A friendly moderator for OSS repos.
                  <br />
                  <br />
                  Jacquez helps keep your GitHub discussions and issues
                  welcoming, respectful, and on-topic, so you can focus on
                  building great software.
                </p>
              </div>
              <div className="flex flex-col gap-2 min-[400px]:flex-row">
                {loading ? (
                  <div className="flex items-center">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-gray-900 dark:border-white mr-2"></div>
                    <span className="text-sm">Loading...</span>
                  </div>
                ) : !isAuthenticated ? (
                  <Button
                    asChild
                    size="lg"
                    className="bg-black dark:bg-white text-white dark:text-black hover:bg-black/90 dark:hover:bg-white/90"
                  >
                    <Link href="/api/auth/github" prefetch={false}>
                      <Github className="mr-2 h-5 w-5" /> Add to a GitHub
                      repository
                    </Link>
                  </Button>
                ) : (
                  <div className="flex flex-col gap-2 min-[400px]:flex-row">
                    <Button
                      asChild
                      size="lg"
                      className="bg-black dark:bg-white text-white dark:text-black hover:bg-black/90 dark:hover:bg-white/90"
                    >
                      <Link href="/repository" prefetch={false}>
                        Manage Repositories
                      </Link>
                    </Button>
                    <Button
                      onClick={handleLogout}
                      size="lg"
                      variant="outline"
                    >
                      Logout
                    </Button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center justify-center">
              <Card className="bg-white dark:bg-black p-6 w-full max-w-none md:max-w-2xl md:mx-auto shadow-none md:shadow-lg rounded-none md:rounded-lg border-x-0 md:border-x">
                <GithubCommentDemo />
              </Card>
            </div>
          </div>
        </div>
      </main>
      <footer className="w-full">
        <div className="container mx-auto flex h-16 items-center justify-center">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            A soon-to-be open-source project by{" "}
            <Link
              href="https://antiwork.com"
              className="font-medium underline-offset-4 hover:underline text-black dark:text-white"
              prefetch={false}
              target="_blank"
              rel="noopener noreferrer"
            >
              Antiwork
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
