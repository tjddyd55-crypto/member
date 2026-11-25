import Pdf from 'react-native-pdf';

export function PdfPreview({ url, onError }: { url: string; onError: () => void }) {
  return <Pdf source={{ uri: url }} trustAllCerts={false} onError={onError}
    onPressLink={() => undefined} style={{ flex: 1, width: '100%' }} />;
}
