import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GatheringGroupSummary } from '@member/contracts';
import { api } from '../../api/client';
import { theme } from '../../theme';
import {
  compactHeaderTitle,
  GLOBAL_MENU_ROUTES,
  gatheringSwitchItems,
  globalMenuNavigation,
  routeHeaderTitle,
  visibleGroupName,
} from './app-menu';

const ChromeContext = createContext(false);

export function useUnderAppChrome() {
  return useContext(ChromeContext);
}

export function AppChrome({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ groupId?: string }>();
  const groupId = typeof params.groupId === 'string' && params.groupId !== 'create' ? params.groupId : undefined;
  const [namedGroup, setNamedGroup] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<GatheringGroupSummary[]>([]);
  const { width } = useWindowDimensions();
  const title = compactHeaderTitle({
    groupName: visibleGroupName(namedGroup, groupId),
    routeTitle: routeHeaderTitle(pathname),
  });

  useEffect(() => {
    if (!groupId) {
      setNamedGroup(null);
      return;
    }
    setNamedGroup((current) => (current?.id === groupId ? current : null));
    let active = true;
    void api
      .group(groupId)
      .then((group) => {
        if (active) setNamedGroup({ id: groupId, name: group.name });
      })
      .catch(() => {
        if (active) setNamedGroup((current) => (current?.id === groupId ? null : current));
      });
    return () => {
      active = false;
    };
  }, [groupId]);

  const showMenu = () => {
    setOpen(true);
    void api
      .groups()
      .then((result) => setGroups(result.items))
      .catch(() => setGroups([]));
  };

  const go = (href: string) => {
    setOpen(false);
    for (const step of globalMenuNavigation(router.canDismiss())) {
      if (step === 'dismiss-all') router.dismissAll();
      else router.replace(href as '/(app)/groups');
    }
  };

  return (
    <ChromeContext.Provider value>
      <View style={styles.root}>
        <View style={[styles.bar, { paddingTop: insets.top }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="메뉴"
            accessibilityState={{ expanded: open }}
            onPress={showMenu}
            style={styles.menuButton}
          >
            <Ionicons name="menu" size={24} color={theme.colors.text.primary} />
          </Pressable>
          <Text accessibilityRole="header" numberOfLines={2} style={styles.title}>
            {title}
          </Text>
        </View>
        <View style={styles.body}>{children}</View>
        <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.drawerRow}>
            <View style={[styles.drawer, { width: Math.min(320, Math.round(width * 0.86)), paddingTop: insets.top }]}>
              <Pressable accessibilityRole="button" accessibilityLabel="메뉴 닫기" onPress={() => setOpen(false)} style={styles.close}>
                <Text style={styles.closeLabel}>닫기</Text>
              </Pressable>
              <ScrollView style={styles.menuScroll} contentContainerStyle={styles.menuContent}>
                {GLOBAL_MENU_ROUTES.map((item) => (
                  <Pressable key={item.id} accessibilityRole="button" onPress={() => go(item.href)} style={styles.item}>
                    <Text style={styles.itemLabel}>{item.label}</Text>
                  </Pressable>
                ))}
                {gatheringSwitchItems(groups, groupId).map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: item.selected }}
                    onPress={() => go(item.href)}
                    style={styles.item}
                  >
                    <Text style={styles.itemLabel} numberOfLines={2}>
                      {item.selected ? `${item.label} · 보는 중` : item.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="메뉴 닫기" style={styles.backdrop} onPress={() => setOpen(false)} />
          </View>
        </Modal>
      </View>
    </ChromeContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg.default },
  body: { flex: 1 },
  bar: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border.default,
    backgroundColor: theme.colors.bg.default,
  },
  menuButton: {
    width: theme.layout.buttonMinHeight,
    height: theme.layout.buttonMinHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    marginRight: theme.space[16],
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: theme.colors.text.primary,
  },
  drawerRow: { flex: 1, flexDirection: 'row' },
  drawer: { height: '100%', backgroundColor: theme.colors.bg.default },
  menuScroll: { flex: 1 },
  menuContent: { paddingBottom: theme.space[16] },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  close: {
    minHeight: theme.layout.buttonMinHeight,
    justifyContent: 'center',
    paddingHorizontal: theme.space[16],
  },
  closeLabel: { fontSize: 16, color: theme.colors.text.primary },
  item: {
    minHeight: theme.layout.buttonMinHeight,
    justifyContent: 'center',
    paddingHorizontal: theme.space[16],
  },
  itemLabel: { fontSize: 16, lineHeight: 22, color: theme.colors.text.primary },
});
