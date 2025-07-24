"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { RepositorySettings } from "@/components/repository-settings";
import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function RepositoryPage() {
    const { isAuthenticated, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && !isAuthenticated) {
            router.push("/");
        }
    }, [isAuthenticated, loading, router]);

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

    if (loading) {
        return (
            <div className="flex flex-col min-h-dvh bg-gray-100 dark:bg-black text-black dark:text-white">
                <div className="flex items-center justify-center flex-1">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-white"></div>
                </div>
            </div>
        );
    }

    if (!isAuthenticated) {
        return null; // Will redirect via useEffect
    }

    return (
        <div className="flex flex-col min-h-dvh bg-gray-100 dark:bg-black text-black dark:text-white">
            <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-black">
                <div className="container mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            <Button variant="ghost" size="sm" asChild>
                                <Link href="/">
                                    <ArrowLeft className="h-4 w-4 mr-2" />
                                    Back to Home
                                </Link>
                            </Button>
                            <div className="flex items-center space-x-2">
                                <svg
                                    width="32"
                                    height="32"
                                    viewBox="0 0 32 32"
                                    fill="none"
                                    aria-hidden="true"
                                    className="inline-block"
                                >
                                    <polygon points="4,28 28,28 28,4" fill="currentColor" />
                                </svg>
                                <h1 className="text-xl font-semibold">Jacquez</h1>
                            </div>
                        </div>
                        <Button onClick={handleLogout} variant="outline" size="sm">
                            Logout
                        </Button>
                    </div>
                </div>
            </header>

            <main className="flex-1 container mx-auto px-6 py-8">
                <div className="max-w-4xl mx-auto">
                    <RepositorySettings />
                </div>
            </main>
        </div>
    );
}