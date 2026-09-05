import { useRef, useState, type DragEvent } from 'react';
import { FileText, UploadCloud } from 'lucide-react';

export interface FileDropzoneProps {
  accept: string;
  disabled?: boolean;
  fileName?: string | null;
  previewUrl?: string | null;
  onFile: (file: File) => void;
}

export function FileDropzone({ accept, disabled, fileName, previewUrl, onFile }: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div>
      <div
        className={`dropzone${dragging ? ' dropzone--active' : ''}`}
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === 'Enter' || event.key === ' ')) inputRef.current?.click();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <UploadCloud />
        <span className="dropzone-text">Selecciona o arrastra una imagen</span>
        <span className="dropzone-hint">Formatos admitidos: imágenes y PDF</span>

        {fileName && (
          <span className="dropzone-filename">
            <FileText size={13} />
            {fileName}
          </span>
        )}

        {previewUrl && <img className="dropzone-preview" src={previewUrl} alt="Vista previa del documento seleccionado" />}

        <input
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onFile(file);
            event.target.value = '';
          }}
          style={{ display: 'none' }}
        />
      </div>
    </div>
  );
}
