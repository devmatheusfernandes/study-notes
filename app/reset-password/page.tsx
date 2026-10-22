import type { Metadata } from "next";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Nova senha — Study Notes",
};

export default function ResetPasswordPage() {
  return (
    <main className="flex flex-1 items-center justify-center bg-background px-4 py-16">
      <ResetPasswordForm />
    </main>
  );
}
