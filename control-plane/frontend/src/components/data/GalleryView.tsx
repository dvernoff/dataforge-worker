import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Image } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent,
} from '@/components/ui/dialog';

interface GalleryViewProps {
  rows: Record<string, unknown>[];
  columns: { name: string; type: string }[];
}

export function GalleryView({ rows, columns }: GalleryViewProps) {
  const { t } = useTranslation('data');

  // Find potential image columns (text columns with url/image/file/photo/avatar/thumbnail in name)
  const imageColumns = useMemo(
    () => columns.filter((c) =>
      ['text', 'character varying', 'varchar'].includes(c.type)
      && (c.name.includes('image') || c.name.includes('url') || c.name.includes('file')
        || c.name.includes('photo') || c.name.includes('avatar') || c.name.includes('thumbnail')
        || c.name.includes('picture') || c.name.includes('src') || c.name.includes('path')),
    ),
    [columns],
  );

  // Fallback: any text column
  const textColumns = useMemo(
    () => columns.filter((c) => ['text', 'character varying', 'varchar'].includes(c.type)),
    [columns],
  );

  const availableColumns = imageColumns.length > 0 ? imageColumns : textColumns;

  const [imageColumn, setImageColumn] = useState(availableColumns[0]?.name ?? '');
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const titleColumn = columns.find(
    (c) => !['id', 'created_at', 'updated_at', 'deleted_at'].includes(c.name)
      && c.name !== imageColumn
      && ['text', 'character varying', 'varchar'].includes(c.type),
  );

  if (availableColumns.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>{t('views.gallery.noImageColumn')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label>{t('views.gallery.imageField')}</Label>
        <Select value={imageColumn} onValueChange={setImageColumn}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableColumns.map((c) => (
              <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {rows.map((row) => {
          const imageUrl = String(row[imageColumn] ?? '');
          const title = titleColumn ? String(row[titleColumn.name] ?? '') : `#${String(row.id).slice(0, 8)}`;
          const isValidUrl = imageUrl.startsWith('http') || imageUrl.startsWith('/');

          return (
            <Card
              key={String(row.id)}
              className="overflow-hidden cursor-pointer hover:shadow-lg transition-shadow group"
              onClick={() => isValidUrl ? setLightboxImage(imageUrl) : undefined}
            >
              <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                {isValidUrl ? (
                  <img
                    src={imageUrl}
                    alt={title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : null}
                <div className={cn('flex flex-col items-center text-muted-foreground', isValidUrl && 'hidden')}>
                  <Image className="h-8 w-8 mb-1" />
                  <span className="text-[10px]">{t('views.gallery.noImage')}</span>
                </div>
              </div>
              <CardContent className="p-2">
                <p className="text-xs font-medium truncate">{title}</p>
                <p className="text-[10px] text-muted-foreground font-mono truncate">{imageUrl || 'N/A'}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Lightbox */}
      <Dialog open={!!lightboxImage} onOpenChange={(o) => { if (!o) setLightboxImage(null); }}>
        <DialogContent className="max-w-4xl p-0 overflow-hidden">
          {lightboxImage && (
            <img
              src={lightboxImage}
              alt="Full size"
              className="w-full h-auto max-h-[80vh] object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
