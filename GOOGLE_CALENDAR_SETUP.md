# Google Calendar Integration Setup Guide for HM Herbs

This guide explains how to set up Google Calendar integration so that EDSA bookings automatically sync to HM Herbs' Google Calendar.

## Overview

When a customer books an EDSA session through the website, the system will:
1. Save the booking to the database
2. Automatically create an event in HM Herbs' Google Calendar
3. Send email notifications to both the customer and HM Herbs
4. Allow HM Herbs to see all bookings directly in their calendar

## Prerequisites

- A Google account for HM Herbs (e.g., hmherbs1@gmail.com)
- Access to Google Cloud Console
- Node.js backend server

## Step 1: Create Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it "HM Herbs Calendar Integration"
4. Click "Create"

## Step 2: Enable Google Calendar API

1. In your project, go to "APIs & Services" → "Library"
2. Search for "Google Calendar API"
3. Click on it and press "Enable"

## Step 3: Create Service Account

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "Service Account"
3. Fill in:
   - **Name**: HM Herbs Calendar Service
   - **Description**: Service account for calendar integration
4. Click "Create and Continue"
5. Skip role assignment (click "Continue")
6. Click "Done"

## Step 4: Create and Download Credentials

1. Click on the service account you just created
2. Go to "Keys" tab
3. Click "Add Key" → "Create new key"
4. Choose "JSON" format
5. Click "Create" - this downloads a JSON file
6. **Rename this file to `google-credentials.json`**
7. **Move it to `backend/config/google-credentials.json`**

## Step 5: Share Calendar with Service Account

1. Open [Google Calendar](https://calendar.google.com/)
2. On the left sidebar, find "My calendars" and click the three dots next to your calendar
3. Select "Settings and sharing"
4. Under "Share with specific people", click "Add people"
5. Enter the service account email (found in the JSON file as `client_email`)
   - It looks like: `hm-herbs-calendar-service@your-project.iam.gserviceaccount.com`
6. Give it "Make changes to events" permission
7. Click "Send"

## Step 6: Configure Environment Variables

Add to your `.env` file or environment:

```env
# Google Calendar Configuration
GOOGLE_CALENDAR_ID=hmherbs1@gmail.com
# OR use the calendar ID from Google Calendar settings
# GOOGLE_CALENDAR_ID=primary

# Path to credentials (optional, defaults to backend/config/google-credentials.json)
GOOGLE_CREDENTIALS_PATH=backend/config/google-credentials.json
```

### Finding Your Calendar ID

1. Go to Google Calendar settings
2. Click on your calendar
3. Scroll to "Integrate calendar"
4. Copy the "Calendar ID" (usually your email address)

## Step 7: Install Required Package

Make sure your backend has the Google APIs package:

```bash
npm install googleapis
```

## Step 8: Test the Integration

1. Start your backend server
2. Make a test booking through the website
3. Check your Google Calendar - you should see the event appear automatically!

## Admin panel: Connect Google Calendar (OAuth)

The admin **Settings → Google Calendar** flow uses OAuth (not the service account JSON above). If you see **Error 403: access_denied** when signing in with `hmherbs1@gmail.com`:

### Fix in Google Cloud Console

1. Open [Google Cloud Console](https://console.cloud.google.com/) → the project that owns client ID `266596824943-...`.
2. **APIs & Services → Library** — enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen**
   - If **Publishing status** is **Testing**, add **hmherbs1@gmail.com** under **Test users** (exact address you sign in with).
   - Add scope `https://www.googleapis.com/auth/calendar` if prompted.
4. **APIs & Services → Credentials** → your **OAuth 2.0 Client ID** (type **Web application**)
   - Under **Authorized redirect URIs**, add exactly:
     ```
     http://localhost:3001/api/admin/settings/google-calendar/callback
     ```
   - For production, also add:
     ```
     https://YOUR-DOMAIN.com/api/admin/settings/google-calendar/callback
     ```
5. In [Google Account permissions](https://myaccount.google.com/permissions), remove the old app entry if you previously denied access, then connect again from admin.

### backend/.env (local)

```env
GCAL_CLIENT_ID=266596824943-....apps.googleusercontent.com
GCAL_CLIENT_SECRET=your_client_secret
# Optional — must match redirect URI in Google Console:
GCAL_REDIRECT_URI=http://localhost:3001/api/admin/settings/google-calendar/callback
ADMIN_APP_URL=http://localhost:3001/admin.html
```

Restart the backend after changing `.env`.

---

## Troubleshooting

### Events Not Appearing

1. **Check service account email**: Make sure you shared the calendar with the correct service account email
2. **Check permissions**: Service account needs "Make changes to events" permission
3. **Check calendar ID**: Verify the `GOOGLE_CALENDAR_ID` in your environment
4. **Check logs**: Look for errors in your backend console

### Authentication Errors

1. **Verify credentials file**: Make sure `google-credentials.json` is in `backend/config/`
2. **Check file format**: Ensure the JSON file is valid
3. **Verify API is enabled**: Go to Google Cloud Console and confirm Calendar API is enabled

### Timezone Issues

The default timezone is set to `America/New_York`. To change it:

1. Edit `backend/services/google-calendar.js`
2. Find `timeZone: 'America/New_York'`
3. Change to your timezone (e.g., `'America/Chicago'`, `'America/Los_Angeles'`)

## Security Notes

- **Never commit `google-credentials.json` to Git**
- Add it to `.gitignore`:
  ```
  backend/config/google-credentials.json
  ```
- Keep your service account credentials secure
- Only share the calendar with the service account, not publicly

## Features

Once set up, the system will:

✅ **Automatically create calendar events** when bookings are made  
✅ **Include customer contact information** in event description  
✅ **Send email notifications** to attendees  
✅ **Check for conflicts** when displaying available time slots  
✅ **Update events** if booking details change  
✅ **Delete events** if bookings are cancelled  

## Manual Calendar Management

Even without the API integration, bookings are still saved to your database. You can:
- View bookings in the admin panel
- Manually add them to your calendar
- Export booking data as needed

The calendar integration is optional but recommended for automatic synchronization.

## Support

If you encounter issues:
1. Check the backend console logs for error messages
2. Verify all steps in this guide were completed
3. Test with a simple calendar event creation
4. Check Google Cloud Console for API quota limits

