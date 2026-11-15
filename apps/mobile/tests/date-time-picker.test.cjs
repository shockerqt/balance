const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const local = Module.createRequire(path.join(root, 'package.json'));
const ts = local('typescript');
const React = local('react');
const renderer = local('react-test-renderer');
const dates = local('./src/lib/dates.ts');

global.IS_REACT_ACT_ENVIRONMENT = true;

const host = (name) => (props) => React.createElement(name, props, props.children);

function loadDateTimePickerField({ platformOS = 'android', scheme = 'light', throwOnRequire = false } = {}) {
  const pickerCalls = [];
  const MockPicker = (props) => {
    pickerCalls.push(props);
    return React.createElement('RNDateTimePicker', props);
  };

  const stubs = {
    react: React,
    'react/jsx-runtime': local('react/jsx-runtime'),
    'react-native': {
      Platform: { OS: platformOS },
      TouchableOpacity: host('TouchableOpacity'),
      View: host('View'),
      TextInput: host('TextInput'),
    },
    '@/lib/dates': dates,
    '@/theme': {
      font: { regular: 'regular', semibold: 'semibold' },
      makeStyles: () => () => new Proxy({}, { get: () => ({}) }),
      useTheme: () => ({ scheme, colors: { text: '#111', textMuted: '#888', surface: '#fff', lineStrong: '#ccc' }, space: { xs: 4, sm: 8, md: 12 }, border: { hairline: 1 }, radius: { lg: 16 } }),
    },
    './Icon': { Icon: host('Icon') },
    './Input': { Input: host('Input') },
    './Text': { Text: host('Text') },
  };

  const filename = path.join(root, 'src/components/ui/DateTimePickerField.tsx');
  const m = new Module(filename, module);
  m.filename = filename;
  m.require = (name) => {
    if (name === '@react-native-community/datetimepicker') {
      if (throwOnRequire) throw new Error('Native module unavailable');
      return { default: MockPicker };
    }
    if (name in stubs) return stubs[name];
    return local(name);
  };
  m._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename
  );
  return { DateTimePickerField: m.exports.DateTimePickerField, pickerCalls };
}

test('device-local date and time helpers round-trip YYYY-MM-DD and HH:mm', () => {
  const localDate = dates.dateIdToLocalDate('2026-11-05');
  assert.equal(localDate.getFullYear(), 2026);
  assert.equal(localDate.getMonth(), 10);
  assert.equal(localDate.getDate(), 5);
  assert.equal(dates.localDateToDateId(localDate), '2026-11-05');

  const invalidDate = dates.dateIdToLocalDate('2026-02-31');
  assert.match(dates.localDateToDateId(invalidDate), /^\d{4}-\d{2}-\d{2}$/);

  const timeDate = dates.timeStringToLocalDate('07:09');
  assert.equal(timeDate.getHours(), 7);
  assert.equal(timeDate.getMinutes(), 9);
  assert.equal(dates.localDateToTimeString(timeDate), '07:09');

  const fallbackTimeDate = dates.timeStringToLocalDate('', '14:45');
  assert.equal(dates.localDateToTimeString(fallbackTimeDate), '14:45');
});

test('DateTimePickerField falls back to Input when native module require fails', async () => {
  const { DateTimePickerField } = loadDateTimePickerField({ throwOnRequire: true });
  const changes = [];
  let view;
  await renderer.act(async () => {
    view = renderer.create(
      React.createElement(DateTimePickerField, {
        mode: 'time',
        value: '09:15',
        onChange: (val) => changes.push(val),
        clearable: true,
        accessibilityLabel: 'Hora habitual',
      })
    );
  });

  const input = view.root.findByType('Input');
  assert.equal(input.props.value, '09:15');
  assert.equal(input.props.accessibilityLabel, 'Hora habitual');
  assert.equal(input.props.editable, true);

  await renderer.act(async () => {
    input.props.onChangeText('10:30');
  });
  assert.deepEqual(changes, ['10:30']);

  const clearBtn = view.root.find((n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Limpiar');
  await renderer.act(async () => {
    clearBtn.props.onPress();
  });
  assert.deepEqual(changes, ['10:30', '']);
});

test('DateTimePickerField on Android opens modal picker, commits selection, and ignores dismiss', async () => {
  const { DateTimePickerField } = loadDateTimePickerField({ platformOS: 'android' });
  const changes = [];
  let view;
  await renderer.act(async () => {
    view = renderer.create(
      React.createElement(DateTimePickerField, {
        mode: 'date',
        value: '2026-10-18',
        onChange: (val) => changes.push(val),
        accessibilityLabel: 'Fecha de destino',
      })
    );
  });

  assert.equal(view.root.findAllByType('RNDateTimePicker').length, 0);
  const trigger = view.root.find((n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Fecha de destino');

  // Open and dismiss
  await renderer.act(async () => {
    trigger.props.onPress();
  });
  let picker = view.root.findByType('RNDateTimePicker');
  assert.equal(picker.props.display, 'default');
  assert.equal(picker.props.mode, 'date');

  await renderer.act(async () => {
    picker.props.onChange({ type: 'dismissed' }, undefined);
  });
  assert.equal(view.root.findAllByType('RNDateTimePicker').length, 0);
  assert.deepEqual(changes, []);

  // Open and select a new date
  await renderer.act(async () => {
    trigger.props.onPress();
  });
  picker = view.root.findByType('RNDateTimePicker');
  await renderer.act(async () => {
    picker.props.onChange({ type: 'set' }, new Date(2026, 10, 22, 12, 0, 0, 0));
  });
  assert.equal(view.root.findAllByType('RNDateTimePicker').length, 0);
  assert.deepEqual(changes, ['2026-11-22']);
});

test('DateTimePickerField on iOS uses compact display, themeVariant, and clearable mode', async () => {
  const { DateTimePickerField } = loadDateTimePickerField({ platformOS: 'ios', scheme: 'dark' });
  const changes = [];
  let view;
  await renderer.act(async () => {
    view = renderer.create(
      React.createElement(DateTimePickerField, {
        mode: 'time',
        value: '12:00',
        onChange: (val) => changes.push(val),
        clearable: true,
        accessibilityLabel: 'Hora habitual',
      })
    );
  });

  const picker = view.root.findByType('RNDateTimePicker');
  assert.equal(picker.props.display, 'compact');
  assert.equal(picker.props.themeVariant, 'dark');
  assert.equal(picker.props.mode, 'time');

  const clearBtn = view.root.find((n) => n.type === 'TouchableOpacity' && n.props.accessibilityLabel === 'Limpiar');
  await renderer.act(async () => {
    clearBtn.props.onPress();
  });
  assert.deepEqual(changes, ['']);
});
