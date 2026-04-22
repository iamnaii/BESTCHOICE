import { Card, CardHeader, CardBody, CardFooter, CardTitle } from '@/components/ui/card';

export default function CardStory() {
  return (
    <div className="p-8 grid md:grid-cols-2 gap-4">
      {(['plain', 'elevated', 'outlined', 'interactive'] as const).map((v) => (
        <Card key={v} variant={v}>
          <CardHeader>
            <CardTitle>{v} card</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="text-sm text-muted-foreground leading-snug">
              ตัวอย่าง body ข้อความภาษาไทย สระ ิ ี ุ ูู ้ ป็ ก็
            </p>
          </CardBody>
          <CardFooter>footer</CardFooter>
        </Card>
      ))}
    </div>
  );
}
