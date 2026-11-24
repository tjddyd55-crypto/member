import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CommonActions } from '@react-navigation/native';
import { router, useGlobalSearchParams, usePathname } from 'expo-router';
import { store } from 'expo-router/build/global-state/router-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { GatheringGroupDetail, GatheringGroupSummary } from '@member/contracts';
import { api } from '../../api/client';
import { loadDrawerGroup } from './load-drawer-group';
import { theme } from '../../theme';
import {
  compactHeaderTitle,
  drawerSections,
  type HandoverActions,
  globalMenuNavigation,
  hardwareBackDestination,
  rootResetTarget,
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
  const eventDetail =
    /\/groups\/[^/]+\/events\/[^/]+$/.test(pathname) && !pathname.endsWith('/new');
  const params = useGlobalSearchParams<{ groupId?: string }>();
  const groupId =
    typeof params.groupId === 'string' && params.groupId !== 'create' ? params.groupId : undefined;
  const [namedGroup, setNamedGroup] = useState<{ id: string; name: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<GatheringGroupSummary[]>([]);
  const [menuGroup, setMenuGroup] = useState<GatheringGroupDetail | null>(null);
  const [handoverActions, setHandoverActions] = useState<HandoverActions | null>(null);
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

  useEffect(() => {
    setMenuGroup(null);
    setHandoverActions(null);
    if (!open) return;
    let active = true;
    void api.groups().then((result) => { if (active) setGroups(result.items); }).catch(() => { if (active) setGroups([]); });
    if (groupId) {
      void loadDrawerGroup({
        loadGroup: () => api.group(groupId),
        loadHandover: () => api.handover(groupId),
        isActive: () => active,
        onGroup: (group) => {
          setNamedGroup({ id: group.id, name: group.name });
          setMenuGroup(group);
        },
        onActions: setHandoverActions,
      });
    }
    return () => { active = false; };
  }, [open, groupId]);

  const showMenu = () => {
    setMenuGroup(null);
    setHandoverActions(null);
    setOpen(true);
  };

  const go = (href: string) => {
    setOpen(false);
    if (globalMenuNavigation() === 'reset' && resetToHref(href)) return;
    router.replace(href as '/(app)/groups');
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (open) {
        setOpen(false);
        return true;
      }
      const href = hardwareBackDestination(pathname, router.canGoBack());
      if (!href) return false;
      if (!resetToHref(href)) router.replace(href as '/(app)/groups');
      return true;
    });
    return () => subscription.remove();
  }, [pathname, open]);

  return (
    <ChromeContext.Provider value>
      <View style={styles.root}>
        {eventDetail ? (
          <View style={{ height: insets.top }} />
        ) : (
          <View style={[styles.bar, { paddingTop: insets.top, paddingLeft: theme.layout.horizontalGutter + insets.left, paddingRight: theme.layout.horizontalGutter + insets.right }]}>
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
        )}
        <View style={styles.body}>{children}</View>
        <Modal
          transparent
          visible={open}
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <View style={styles.drawerRow}>
            <View
              style={[
                styles.drawer,
                { width: Math.min(320, width - 2 * theme.layout.horizontalGutter), paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right },
              ]}
            >
              <View style={styles.drawerHeader}>
                <Text style={styles.appTitle}>JCI KOREA</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="메뉴 닫기" onPress={() => setOpen(false)} style={styles.close}>
                  <Ionicons name="close" size={24} color={theme.colors.text.primary} />
                </Pressable>
              </View>
              <ScrollView style={styles.menuScroll} contentContainerStyle={styles.menuContent}>
                {drawerSections(groups, groupId, menuGroup, handoverActions).map((section, index) => (
                  <View key={section.id}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <Text accessibilityRole="header" numberOfLines={1} ellipsizeMode="tail" style={styles.sectionTitle}>{section.title}</Text>
                    {section.items.map((item) => (
                      <Pressable
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityState={{ selected: Boolean(item.selected) }}
                        onPress={() => go(item.href)}
                        style={[styles.item, item.selected && styles.selectedItem]}
                      >
                        <View style={styles.itemIcon}>
                          {item.selected ? (
                            <Ionicons name="checkmark" size={20} color={theme.colors.primary.default} />
                          ) : item.icon ? (
                            <Ionicons name={item.icon} size={20} color={theme.colors.text.secondary} />
                          ) : null}
                        </View>
                        <Text style={[styles.itemLabel, item.selected && styles.selectedLabel]} numberOfLines={1}>{item.label}</Text>
                      </Pressable>
                    ))}
                  </View>
                ))}
              </ScrollView>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="메뉴 닫기"
              style={styles.backdrop}
              onPress={() => setOpen(false)}
            />
          </View>
        </Modal>
      </View>
    </ChromeContext.Provider>
  );
}

function resetToHref(href: string) {
  const navigation = store.navigationRef;
  if (!navigation.isReady()) return false;
  const state = store.getStateForHref(href);
  const root = navigation.getRootState();
  const target = rootResetTarget(root, state);
  if (!target || !state) return false;
  navigation.dispatch({ ...CommonActions.reset(state), target });
  return true;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg.default },
  body: { flex: 1 },
  bar: {
    paddingHorizontal: theme.layout.horizontalGutter,
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
    marginRight: 0,
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
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.layout.horizontalGutter },
  appTitle: { fontSize: 13, fontWeight: '600', color: theme.colors.text.secondary },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 12, fontWeight: '600', color: theme.colors.text.secondary, paddingHorizontal: theme.layout.horizontalGutter, paddingTop: 12, paddingBottom: 8 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border.default, marginHorizontal: theme.layout.horizontalGutter, marginVertical: 8 },
  item: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: theme.layout.horizontalGutter },
  itemIcon: { width: 20, alignItems: 'center', justifyContent: 'center' },
  selectedItem: { backgroundColor: theme.colors.primary.soft },
  selectedLabel: { color: theme.colors.primary.default, fontWeight: '700' },
  itemLabel: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 22, color: theme.colors.text.primary },
});
