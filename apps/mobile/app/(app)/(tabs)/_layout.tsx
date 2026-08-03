import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { theme } from '../../../src/theme';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 11, color: focused ? theme.colors.primary.default : theme.colors.text.secondary }}>
      {label}
    </Text>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary.default,
        tabBarInactiveTintColor: theme.colors.text.secondary,
        tabBarStyle: {
          minHeight: 64,
          paddingBottom: 8,
          borderTopColor: theme.colors.border.default,
          backgroundColor: theme.colors.surface.default,
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: '홈',
          tabBarIcon: ({ focused }) => <TabIcon label="홈" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="members"
        options={{
          title: '회원수첩',
          tabBarIcon: ({ focused }) => <TabIcon label="회원" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: '일정',
          tabBarIcon: ({ focused }) => <TabIcon label="일정" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          title: '정관·자료',
          tabBarIcon: ({ focused }) => <TabIcon label="자료" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: '내정보',
          tabBarIcon: ({ focused }) => <TabIcon label="내정보" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
