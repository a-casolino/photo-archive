import { ShareHome } from "@/app/ui/gallery/share-views";
import { getLinkShare } from "@/lib/shares";
import { LinkMissing } from "./missing";

export default async function LinkSharePage({ params, searchParams }: PageProps<"/l/[token]">) {
  const { token } = await params;
  const share = await getLinkShare(token);
  if (!share) return <LinkMissing token={token} />;
  return (
    <ShareHome
      share={share}
      base={`/l/${token}`}
      role={null}
      userId={null}
      access={{ token }}
      searchParams={await searchParams}
    />
  );
}
