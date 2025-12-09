# 🔍 TFD Trade Market Helper Desktop Electron App
A modern, stylized enhancement for **The First Descendant** Trade Market, built to fix the limitations of the official site and give players powerful filtering, sorting, and analysis tools.

This app captures all market results automatically, parses them, and displays them in a **fast**, **readable**, **interactive**, and **modern UI**.


## Ancestor Module Mode
<img width="2560" height="1369" alt="image" src="https://github.com/user-attachments/assets/1ff624a8-6194-4ea4-8d8a-608d9fc355a3" />




## Trigger Module Mode
<img width="2560" height="1369" alt="vrNsuYZElT" src="https://github.com/user-attachments/assets/20ca385e-59f5-42f6-8a17-1ec23845c27d" />



---

## ✨ Why This Was Made
The official TFD market page is visually appealing but **extremely inefficient** to use:
  
- No bulk viewing or advanced filtering  
- No way to exclude specific negative stats  
- Hard to compare items at a glance  
- No grid view, no sorting by important metrics  
- No dedicated UI for Ancestor vs Trigger modules

This extension fixes all of that and more.

---

## 🚀 Key Features

### 🧠 Intelligent Data Capture
- Auto-scrolls through the entire results page  
- Waits for The First Descendant’s lazy-loader to finish  
- Detects market mode (Ancestor or Trigger Modules)  
- Parses every card into structured, filterable data
- Renameable Tabs - Double click to rename

### 🎯 Module-Specific Filtering
#### **Ancestor Modules**
- Search by positive skill attributes  
- Exclude negative attributes  
- Filter by:  
  - Socket type  
  - Mastery Rank  
  - Seller MR  
  - Rerolls  
  - Status (Online / Offline)  
  - Price range  
  - Listing age (hours/days)

#### **Trigger Modules**
- Auto-detects the module’s two attributes  
- Provides min/max % filters for each attribute  
- No unnecessary filters shown  
- Perfectly tuned for Trigger-style results

### 🎨 Fully Modernized Interface
- Dark-mode UI with tasteful lighting  
- Soft neon accents & frosted-glass panels  
- Animated hover + interaction states  
- Responsive layout  
- Themed scrollbars  
- Matching gradients between sidebar, header, and grid

### 🧹 Smart Inventory Controls
- Clear button for main attribute search  
- Clear button for negative attribute search  
- Smooth dropdowns, tag-style selection chips  
- Centered filter chips beneath each bar  
- Dynamic spacing & alignment for text & filter blocks

### 🛒 Convenient Seller Tools
- Click-to-copy seller name  
- Seller MR visually emphasized  
- Status icons color-coded  
- Clean card layouts for quick scanning

---

## 💻 Installation (Desktop App)

The app is packaged as an Electron-based desktop executable.

### 1️⃣ Download the Desktop Build

From the GitHub Releases page, download the latest **TFD Trade Market Helper – Desktop** build (typically a `.zip` or `.exe` for Windows).

If you downloaded a ZIP:

1. Extract it to a folder of your choice (e.g., `C:\Games\TFD.Market.Helper.0.2.0.exe`).

You should see files similar to:

- `TFD.Market.Helper.0.2.0.exe`
- `resources/` (Electron app bundle)

### 2️⃣ Run the App

1. Double-click **`TFD.Market.Helper.0.2.0.exe`**
2. Windows may show a SmartScreen prompt (standard for unsigned tools).
   - Click **More info** → **Run anyway** if you trust the binary.

The app will open its own window and is now ready to use.

---

## 🕹️ How to Use

### 🟪 1. Set search info on the left sidebar  
Set module name, platform, and module type

### 🟪 2. Wait for the app to pull down information from the market 
While its running you can choose:  
- Module type  
- Socket  
- Platform  
- Search term  
- Sorting
- Price
- etc  

### 🟪 3. Explore the Transformed Market  
You now get:  
- Grid layout  
- Module-type-specific filters  
- Attribute search  
- Negative attribute exclusion  
- Adaptive card sizing  
- Sorting controls  
- Real-time filtering  

- Note: For trigger modules please only filter for one specific module at a time and not an unfiltered list of different modules
- For example - just all "Power Beyond" and not the mixed list of power beyond with kuiper hollow points for example this is due to how it dynamically allocates the min/max filter for trigger modules 
- Ancestor modules however can be mixed so its fine for the ancestor module mode just not trigger modules 


---


## 🛠️ Tech Stack
- Electron (Chromium + Node.js)
- Vanilla JS  
- Tailwind-inspired custom CSS   
- DOM Parsing + Mutation Observers  
- No frameworks required  

---

## 🧭 Notes & Limitations
- The extension **does not hook into Nexon's API**.  
- All data comes from the rendered DOM after autoscroll.  
- It must load results fully on the official site in the hidden window before processing.

---

## ❤️ Special Thanks
I hope this tool is helpful for the community!


---

## 📜 License
MIT License = free to modify and distribute.

---

## ⭐ If you like this project...
Don't forget to **star the repo** and share it with other Descendants!

