export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 font-sans">
      <h1 className="text-3xl font-semibold tracking-tight">bandleader</h1>
      <p className="max-w-md text-center text-zinc-500">
        The bandleader decides which model takes the solo. Adapter layer only
        for now. UI lands in S3.
      </p>
    </main>
  );
}
