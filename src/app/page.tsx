import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

export default async function Home() {
  const user = await getCurrentUser();
  redirect(!user ? "/login" : user.role === "owner" ? "/album" : "/dashboard");
}
