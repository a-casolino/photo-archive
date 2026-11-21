import { SharedPhoto } from "@/app/ui/gallery/share-views";
import { linkShareMetadata, linkShareOnce } from "@/app/ui/gallery/share-metadata";
import { LinkMissing } from "../../missing";

export async function generateMetadata({ params, searchParams }: PageProps<"/l/[token]/foto/[id]">) {
  const { token, id } = await params;
  return linkShareMetadata(token, await searchParams, id);
}

export default async function LinkSharePhotoPage({ params, searchParams }: PageProps<"/l/[token]/foto/[id]">) {
  const { token, id } = await params;
  const share = await linkShareOnce(token);
  if (!share) return <LinkMissing token={token} />;
  return (
    <SharedPhoto
      share={share}
      base={`/l/${token}`}
      role={null}
      userId={null}
      access={{ token }}
      searchParams={await searchParams}
      photoPid={id}
    />
  );
}
