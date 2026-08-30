"use client";
import { useState, useEffect } from "react";
import { CookieIcon } from "lucide-react";
import {
    Vault,
    VaultContent,
    VaultHeader,
    VaultTitle,
    VaultFooter,
    VaultPrimaryButton,
    VaultSecondaryButton,
} from "@/components/ui/vault";

export default function CookieConsent() {
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        const consent = localStorage.getItem("cookie_consent");
        if (!consent) {
            const timer = setTimeout(() => setIsVisible(true), 1000);
            return () => clearTimeout(timer);
        }
    }, []);

    const handleAccept = () => {
        localStorage.setItem("cookie_consent", "accepted");
        setIsVisible(false);
    };

    const handleDecline = () => {
        localStorage.setItem("cookie_consent", "declined");
        setIsVisible(false);
    };

    return (
        <Vault open={isVisible} onOpenChange={setIsVisible}>
            <VaultContent showHandle={false}>
                <VaultHeader showCloseButton={false}>
                    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                        <CookieIcon className="h-7 w-7 text-primary" />
                    </div>

                    <VaultTitle>Aceitar Cookies</VaultTitle>
                </VaultHeader>

                <VaultFooter className="flex-col-reverse sm:flex-row sm:justify-center gap-3 mt-4 border-none pt-2">
                    <VaultSecondaryButton
                        onClick={handleDecline}
                        className="w-full sm:w-auto"
                    >
                        Recusar
                    </VaultSecondaryButton>

                    <VaultPrimaryButton
                        onClick={handleAccept}
                        className="w-full sm:w-auto"
                    >
                        Aceitar
                    </VaultPrimaryButton>
                </VaultFooter>
            </VaultContent>
        </Vault>
    );
}