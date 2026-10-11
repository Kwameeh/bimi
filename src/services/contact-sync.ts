import * as Contacts from 'expo-contacts/legacy';
import { Platform } from 'react-native';

export type DeviceContactPayload = {
  deviceContactId: string;
  name?: string;
  phoneNumbers: string[];
};

export type ContactPermissionState =
  | 'unsupported'
  | 'undetermined'
  | 'denied'
  | 'limited'
  | 'granted';

const CONTACT_FIELDS = [Contacts.Fields.ID, Contacts.Fields.Name, Contacts.Fields.PhoneNumbers];

export function normalizePhone(value?: string | null) {
  const digits = value?.replace(/\D/g, '');
  return digits && digits.length >= 7 ? digits : undefined;
}

export async function getContactPermissionState(): Promise<ContactPermissionState> {
  if (Platform.OS === 'web') return 'unsupported';
  const permission = await Contacts.getPermissionsAsync();
  if (permission.status === 'granted') {
    return permission.accessPrivileges === 'limited' ? 'limited' : 'granted';
  }
  return permission.canAskAgain ? 'undetermined' : 'denied';
}

export async function requestContactPermission(): Promise<ContactPermissionState> {
  if (Platform.OS === 'web') return 'unsupported';
  const permission = await Contacts.requestPermissionsAsync();
  if (permission.status === 'granted') {
    return permission.accessPrivileges === 'limited' ? 'limited' : 'granted';
  }
  return permission.canAskAgain ? 'undetermined' : 'denied';
}

export async function readDeviceContacts(): Promise<DeviceContactPayload[]> {
  const response = await Contacts.getContactsAsync({
    fields: CONTACT_FIELDS,
    pageSize: 0,
  });

  return response.data
    .map((contact) => ({
      deviceContactId: contact.id,
      name: contact.name || undefined,
      phoneNumbers:
        contact.phoneNumbers
          ?.map((phone) => phone.number ?? phone.digits)
          .filter((phoneNumber): phoneNumber is string => Boolean(phoneNumber)) ?? [],
    }))
    .filter((contact) => contact.phoneNumbers.some((phoneNumber) => normalizePhone(phoneNumber)));
}

export async function createDeviceContact(args: {
  name: string;
  phoneNumber: string;
}): Promise<string> {
  return await Contacts.addContactAsync({
    contactType: Contacts.ContactTypes.Person,
    name: args.name,
    phoneNumbers: [
      {
        label: 'mobile',
        number: args.phoneNumber,
      },
    ],
  });
}

export function addDeviceContactsChangeListener(listener: () => void) {
  if (Platform.OS === 'web') return undefined;
  return Contacts.addContactsChangeListener(listener);
}
