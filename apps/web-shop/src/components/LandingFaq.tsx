import { Card, CardBody, SectionHeader, Stack } from '@/components';

export function LandingFaq({
  title,
  items,
}: {
  title: string;
  items: readonly { question: string; answer: string }[];
}) {
  return (
    <section>
      <SectionHeader title={title} />
      <Stack gap={3}>
        {items.map((f) => (
          <Card key={f.question} variant="outlined">
            <CardBody>
              <h3 className="font-semibold leading-snug">{f.question}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground leading-snug">{f.answer}</p>
            </CardBody>
          </Card>
        ))}
      </Stack>
    </section>
  );
}
