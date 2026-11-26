import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import { COLORS } from "@/theme/tokens";

export type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  description: string;
  /** Lignes secondaires (sélections concernées, détails chiffrés). */
  items?: string[];
  /** Phrase de conséquence affichée sous la description. */
  note?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirmation maison au style de l'app : carte blanche centrée, icône d'alerte
 * ambre, bouton d'action rouge. Remplace les `Alert.alert` système.
 */
export function ConfirmDialog({
  visible,
  title,
  description,
  items,
  note,
  confirmLabel,
  cancelLabel = "Annuler",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable accessibilityLabel="Fermer" style={StyleSheet.absoluteFill} onPress={onCancel} />
        <View style={styles.dialog} accessibilityViewIsModal>
          <View style={styles.badge}>
            <AlertTriangle size={19} color="#b45309" strokeWidth={2.3} />
          </View>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.text}>{description}</Text>
          {items && items.length > 0 ? (
            <View style={styles.list}>
              {items.map((item) => (
                <Text key={item} numberOfLines={1} style={styles.listText}>
                  · {item}
                </Text>
              ))}
            </View>
          ) : null}
          {note ? <Text style={styles.text}>{note}</Text> : null}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={({ pressed }) => [styles.cancel, pressed && { opacity: 0.75 }]}
            >
              <Text style={styles.cancelText}>{cancelLabel}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onConfirm}
              style={({ pressed }) => [styles.confirm, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.48)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  dialog: { backgroundColor: "white", borderRadius: 18, padding: 18, gap: 8 },
  badge: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fef3c7",
  },
  title: { color: COLORS.ink, fontSize: 15, fontWeight: "700" },
  text: { color: COLORS.mist, fontSize: 11.5, lineHeight: 17 },
  list: {
    borderRadius: 12,
    backgroundColor: COLORS.elev,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 4,
  },
  listText: { color: COLORS.ink, fontSize: 11 },
  actions: { flexDirection: "row", gap: 8, marginTop: 6 },
  cancel: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.elev,
  },
  cancelText: { color: COLORS.ink, fontSize: 11.5, fontWeight: "500" },
  confirm: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.betclicRed,
  },
  confirmText: { color: "white", fontSize: 11.5, fontWeight: "600" },
});
