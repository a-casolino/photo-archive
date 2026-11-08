import { ShareHome } from "@/app/ui/gallery/share-views";
import { getLinkShare } from "@/lib/shares";
import { LinkUnavailable } from "./unavailable";

export default async function LinkSharePage({ params, searchParams }: PageProps<"/l/[token]">) {
  const { token } = await params;
  const share = await getLinkShare(token);
  if (!share) return <LinkUnavailable />;
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
