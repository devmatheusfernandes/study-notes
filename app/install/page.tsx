import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstallCard } from "./install-card";

export const metadata: Metadata = {
  title: "Instalar — Study Notes",
  description: "Instale o Study Notes no seu dispositivo e use offline, como um app nativo.",
};

export default function InstallPage() {
  return (
    <main className="relative flex flex-1 items-center justify-center bg-background px-4 py-16">
      <Button
        variant="ghost"
        size="sm"
        leftIcon={<ArrowLeft />}
        render={<Link href="/" />}
        className="absolute left-4 top-6 sm:left-8 sm:top-8"
      >
        Início
      </Button>
      <InstallCard />
    </main>
  );
}
