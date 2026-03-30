export default function QueryErrorBlock({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="text-center py-8">
      <p className="text-sm text-destructive mb-2">{message}</p>
      <button onClick={onRetry} className="text-xs text-primary hover:underline">ลองใหม่</button>
    </div>
  );
}
