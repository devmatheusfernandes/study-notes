import { createClient } from "@/lib/supabase/server";
import { UserMenuClient } from "./user-menu-client";

export async function UserMenu() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <UserMenuClient email={user?.email} />;
}
