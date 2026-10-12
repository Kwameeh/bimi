import React, { createContext, useCallback, useContext, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AlertOptions = {
  title: string;
  message?: string;
  icon?: AppIconName;
  iconColor?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm?: () => void | Promise<void>;
  onCancel?: () => void;
};

export type ConfirmOptions = Omit<AlertOptions, 'onConfirm' | 'onCancel'>;

type AlertContextType = {
  showAlert: (options: AlertOptions) => void;
  showConfirm: (options: ConfirmOptions) => Promise<boolean>;
  closeAlert: () => void;
};

const AlertContext = createContext<AlertContextType | null>(null);

export function CustomAlertDialog({
  visible,
  title,
  message,
  icon,
  iconColor,
  confirmText = 'OK',
  cancelText,
  destructive = false,
  onConfirm,
  onCancel,
  busy = false,
}: AlertOptions & { visible: boolean; busy?: boolean }) {
  const theme = useTheme();

  if (!visible) return null;

  const defaultIcon: AppIconName = destructive ? 'error' : icon ? icon : 'sparkles';
  const defaultIconColor = iconColor ?? (destructive ? theme.danger : theme.primary);

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: theme.background,
              borderColor: theme.border,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Header Icon */}
          <View
            style={[
              styles.iconCircle,
              {
                backgroundColor: destructive ? `${theme.danger}1A` : theme.backgroundElement,
                borderColor: destructive ? `${theme.danger}33` : theme.border,
              },
            ]}
          >
            <AppIcon name={defaultIcon} tintColor={defaultIconColor} size={22} />
          </View>

          {/* Title & Message */}
          <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
            {title}
          </Text>
          {message ? (
            <Text style={[styles.message, { color: theme.textSecondary }]}>{message}</Text>
          ) : null}

          {/* Action Buttons */}
          <View style={styles.buttonRow}>
            {cancelText ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={cancelText}
                onPress={onCancel}
                disabled={busy}
                style={({ pressed }) => [
                  styles.button,
                  styles.cancelButton,
                  {
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                    opacity: pressed ? 0.7 : 1,
                  },
                ]}
              >
                <Text style={[styles.cancelText, { color: theme.text }]}>{cancelText}</Text>
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={confirmText}
              onPress={onConfirm}
              disabled={busy}
              style={({ pressed }) => [
                styles.button,
                styles.confirmButton,
                {
                  backgroundColor: destructive ? theme.danger : theme.primary,
                  opacity: pressed ? 0.8 : busy ? 0.6 : 1,
                },
              ]}
            >
              {busy ? (
                <ActivityIndicator color={theme.primaryText} size="small" />
              ) : (
                <Text style={[styles.confirmText, { color: theme.primaryText }]}>
                  {confirmText}
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
  const [currentAlert, setCurrentAlert] = useState<AlertOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingPromise, setPendingPromise] = useState<{
    resolve: (value: boolean) => void;
  } | null>(null);

  const showAlert = useCallback((options: AlertOptions) => {
    setCurrentAlert(options);
  }, []);

  const showConfirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setPendingPromise({ resolve });
      setCurrentAlert({
        ...options,
        cancelText: options.cancelText ?? 'Cancel',
        confirmText: options.confirmText ?? 'Confirm',
        onConfirm: () => {
          resolve(true);
          setCurrentAlert(null);
          setPendingPromise(null);
        },
        onCancel: () => {
          resolve(false);
          setCurrentAlert(null);
          setPendingPromise(null);
        },
      });
    });
  }, []);

  const closeAlert = useCallback(() => {
    if (pendingPromise) {
      pendingPromise.resolve(false);
      setPendingPromise(null);
    }
    setCurrentAlert(null);
  }, [pendingPromise]);

  return (
    <AlertContext.Provider value={{ showAlert, showConfirm, closeAlert }}>
      {children}
      {currentAlert ? (
        <CustomAlertDialog
          visible={!!currentAlert}
          title={currentAlert.title}
          message={currentAlert.message}
          icon={currentAlert.icon}
          iconColor={currentAlert.iconColor}
          confirmText={currentAlert.confirmText}
          cancelText={currentAlert.cancelText}
          destructive={currentAlert.destructive}
          busy={busy}
          onConfirm={async () => {
            if (currentAlert.onConfirm) {
              setBusy(true);
              try {
                await currentAlert.onConfirm();
              } finally {
                setBusy(false);
                closeAlert();
              }
            } else {
              closeAlert();
            }
          }}
          onCancel={() => {
            if (currentAlert.onCancel) {
              currentAlert.onCancel();
            }
            closeAlert();
          }}
        />
      ) : null}
    </AlertContext.Provider>
  );
}

export function useAlert(): AlertContextType {
  const context = useContext(AlertContext);
  if (!context) {
    throw new Error('useAlert must be used within an AlertProvider');
  }
  return context;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontFamily: Fonts.sansBold,
    textAlign: 'center',
    letterSpacing: -0.2,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    fontFamily: Fonts.sans,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 20,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    marginTop: 4,
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    borderWidth: StyleSheet.hairlineWidth,
  },
  confirmButton: {},
  cancelText: {
    fontSize: 15,
    fontFamily: Fonts.sansSemiBold,
  },
  confirmText: {
    fontSize: 15,
    fontFamily: Fonts.sansBold,
  },
});
