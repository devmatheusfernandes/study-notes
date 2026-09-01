import { createClient } from "@/lib/supabase/server";
import { UserMenuClient } from "./user-menu-client";

export async function UserMenu() {
  const supabase = await createClient();
  // getSession() reads the already-validated cookie locally — no network
  // round-trip. proxy.ts's middleware already called the network-validating
  // getUser() for this exact request (redirecting to /login if it failed),
  // so re-validating again here just to display an email would be a second,
  // fully redundant hit to the Supabase Auth server on every navigation.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return <UserMenuClient email={session?.user?.email} />;
}
