import React, { useMemo, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Button, Card, ProgressBar, Screen, Text } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useFoodLibraryStore } from '@/hooks/use-food-library-store';
import { useMealStore } from '@/hooks/use-meal-store';
import { makeStyles, useTheme } from '@/theme';
import {
  buildMacroFactorDocumentPlan,
  MacroFactorDocumentPlan,
  MacroFactorParseResult,
  parseMacroFactorWorkbook,
} from '@/services/import/macro-factor';
import { ImportSummary, macroFactorFingerprint, uploadMacroFactorImport } from '@/services/import/macro-factor-client';
import { commitGuestImport } from '@/services/import/guest-import';

interface Selection {
  name: string;
  fingerprint: string;
  parsed: MacroFactorParseResult;
  plan: MacroFactorDocumentPlan;
}

type Phase = 'idle' | 'reading' | 'preview' | 'importing' | 'complete';

export default function MacroFactorImportScreen() {
  const styles = useStyles();
  const theme = useTheme();
  const { user, isGuest, authorizedFetch } = useAuth();
  const { templateDocuments, replaceTemplateDocuments } = useFoodLibraryStore();
  const { mealDocuments, replaceMealDocuments } = useMealStore();
  const [phase, setPhase] = useState<Phase>('idle');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [progress, setProgress] = useState({ completed: 0, total: 1 });
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewSummary = useMemo(() => {
    if (!selection) return null;
    return {
      templates: selection.plan.templateSummary,
      logs: selection.plan.logSummary,
    };
  }, [selection]);

  const chooseFile = async () => {
    setError(null);
    setSummary(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
        'text/csv',
        'text/comma-separated-values',
        'application/csv',
        'text/plain',
      ],
      copyToCacheDirectory: true,
      multiple: false,
      base64: false,
    });
    if (result.canceled) return;
    setPhase('reading');
    const asset = result.assets[0];
    try {
      if (asset.size != null && asset.size > 25 * 1024 * 1024) {
        throw new Error('El archivo supera el límite de 25 MB');
      }
      const buffer = asset.file ? await asset.file.arrayBuffer() : await new File(asset.uri).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const parsed = parseMacroFactorWorkbook(bytes);
      if (!parsed.rows.length) throw new Error('El archivo no contiene filas válidas para importar');
      const namespace = user ? `user:${user.id}` : 'guest';
      const plan = buildMacroFactorDocumentPlan(parsed.rows, templateDocuments, mealDocuments, namespace);
      setSelection({
        name: asset.name,
        fingerprint: await macroFactorFingerprint(bytes),
        parsed,
        plan,
      });
      setPhase('preview');
    } catch (caught) {
      setSelection(null);
      setPhase('idle');
      setError(caught instanceof Error ? caught.message : 'No se pudo leer el archivo');
    } finally {
      if (Platform.OS !== 'web') {
        try {
          new File(asset.uri).delete();
        } catch {
          // El selector puede devolver un archivo que no pertenece al cache de la app.
        }
      }
    }
  };

  const importFile = async () => {
    if (!selection) return;
    if (selection.parsed.errors.length) {
      setError('Corrige las filas inválidas antes de importar');
      return;
    }
    setError(null);
    setPhase('importing');
    setProgress({ completed: 0, total: selection.parsed.rows.length });
    try {
      let result: ImportSummary;
      if (isGuest) {
        const templates = [
          ...templateDocuments.filter((doc) => doc.provenance?.provider !== 'macrofactor'),
          ...selection.plan.templates,
        ];
        const logs = [
          ...mealDocuments.filter((doc) => doc.provenance?.provider !== 'macrofactor'),
          ...selection.plan.logs,
        ];
        await commitGuestImport({ templates, logs });
        replaceTemplateDocuments(templates);
        replaceMealDocuments(logs);
        result = {
          templates: selection.plan.templateSummary,
          logs: selection.plan.logSummary,
        };
        setProgress({
          completed: selection.parsed.rows.length,
          total: selection.parsed.rows.length,
        });
      } else {
        result = await uploadMacroFactorImport(
          authorizedFetch,
          selection.fingerprint,
          selection.parsed.rows,
          selection.plan,
          (completed, total) => setProgress({ completed, total }),
        );
      }
      setSummary(result);
      setPhase('complete');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo completar la importación');
      setPhase('preview');
    }
  };

  const effectiveSummary = summary ?? previewSummary;
  const totalChanges = effectiveSummary
    ? effectiveSummary.templates.created +
      effectiveSummary.templates.updated +
      effectiveSummary.templates.deleted +
      effectiveSummary.logs.created +
      effectiveSummary.logs.updated +
      effectiveSummary.logs.deleted
    : 0;

  return (
    <Screen>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.intro}>
          <Text variant="title">Trae tu historial, sin duplicarlo</Text>
          <Text variant="body" tone="secondary">
            Selecciona la exportación XLSX o CSV de MacroFactor. Balance previsualiza los cambios y conserva intactos los
            registros creados manualmente.
          </Text>
        </View>

        <Card style={styles.fileCard}>
          <View style={styles.fileCopy}>
            <Text variant="heading" numberOfLines={1}>
              {selection?.name ?? 'Archivo de MacroFactor'}
            </Text>
            <Text variant="caption" tone="muted">
              {selection ? `${selection.parsed.rows.length} filas válidas` : 'Formato .xlsx o .csv · primera hoja'}
            </Text>
          </View>
          <Button
            title={selection ? 'Elegir otro' : 'Seleccionar archivo'}
            variant="secondary"
            size="md"
            loading={phase === 'reading'}
            disabled={phase === 'importing'}
            onPress={chooseFile}
          />
        </Card>

        {selection && effectiveSummary ? (
          <View style={styles.section}>
            <Text variant="label" tone="muted">
              PREVISUALIZACIÓN
            </Text>
            <Card style={styles.previewCard}>
              <Metric label="Periodo" value={`${selection.parsed.dateStart} — ${selection.parsed.dateEnd}`} />
              <Metric label="Registros de comida" value={String(selection.parsed.rows.length)} />
              <Metric
                label="Alimentos para la biblioteca"
                value={String(selection.plan.templates.filter((doc) => !doc._deleted).length)}
              />
              <Metric label="Quick Add" value={String(selection.parsed.quickAddCount)} />
              <Metric label="Micronutrientes detectados" value={`${selection.parsed.extendedNutrientCount} de 48`} />
              <View style={styles.rule} />
              <Text variant="bodyStrong">
                {totalChanges} cambios · {effectiveSummary.logs.unchanged + effectiveSummary.templates.unchanged} sin
                cambios
              </Text>
              <Text variant="caption" tone="secondary">
                Volver a importar reemplaza únicamente los datos cuyo origen es MacroFactor.
              </Text>
            </Card>
          </View>
        ) : null}

        {selection?.parsed.errors.length ? (
          <Card style={styles.warningCard}>
            <Text variant="heading" tone="danger">
              {selection.parsed.errors.length} filas impiden importar
            </Text>
            <Text variant="caption" tone="secondary">
              Fila {selection.parsed.errors[0].rowIndex}: {selection.parsed.errors[0].message}
              {selection.parsed.errors.length > 1 ? ' · y otras' : ''}. Ningún dato cambiará hasta usar una exportación válida.
            </Text>
          </Card>
        ) : null}

        {phase === 'importing' ? (
          <Card style={styles.progressCard}>
            <View style={styles.progressCopy}>
              <Text variant="heading">Importando historial</Text>
              <Text variant="number" tone="accent">
                {progress.completed} / {progress.total}
              </Text>
            </View>
            <ProgressBar value={progress.completed / progress.total} />
            <Text variant="caption" tone="muted">
              No cierres Balance hasta que termine.
            </Text>
          </Card>
        ) : null}

        {phase === 'complete' && summary ? (
          <Card style={[styles.resultCard, { borderColor: theme.colors.success }]}>
            <Text variant="title">Importación completada</Text>
            <Text variant="body" tone="secondary">
              {summary.logs.created} registros creados, {summary.logs.updated} actualizados y {summary.logs.deleted}{' '}
              eliminados.
            </Text>
          </Card>
        ) : null}

        {error ? (
          <Card style={styles.errorCard}>
            <Text variant="heading" tone="danger">
              No se pudo importar
            </Text>
            <Text variant="body" tone="secondary" selectable>
              {error}
            </Text>
          </Card>
        ) : null}

        {phase === 'preview' ? (
          <Button
            title={selection?.parsed.errors.length ? 'Archivo con errores' : 'Importar a Balance'}
            disabled={!!selection?.parsed.errors.length}
            onPress={importFile}
          />
        ) : null}
      </ScrollView>
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.metric}>
      <Text variant="body" tone="secondary">
        {label}
      </Text>
      <Text variant="number" selectable>
        {value}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  content: { padding: theme.space.xl, gap: theme.space.xl },
  intro: { gap: theme.space.sm },
  section: { gap: theme.space.sm },
  fileCard: { flexDirection: 'row', alignItems: 'center', gap: theme.space.md },
  fileCopy: { flex: 1, gap: theme.space.xs },
  previewCard: { gap: theme.space.md },
  metric: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: theme.space.md,
  },
  rule: { height: theme.border.hairline, backgroundColor: theme.colors.border },
  warningCard: { gap: theme.space.sm, borderColor: theme.colors.danger },
  progressCard: { gap: theme.space.md },
  progressCopy: { flexDirection: 'row', justifyContent: 'space-between' },
  resultCard: { gap: theme.space.sm },
  errorCard: { gap: theme.space.sm, borderColor: theme.colors.danger },
}));
