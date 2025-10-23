# Setting Up Gemini in Jupyter Notebook

## Step 1: Get Google API Key
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Click "Create API Key"
3. Copy the key

## Step 2: Add to .env file
Add this line to your `.env` file:
```
GOOGLE_API_KEY=your_api_key_here
```

## Step 3: Install packages
In your terminal:
```bash
pip install google-generativeai jupyter
```

## Step 4: Start Jupyter
```bash
jupyter notebook gemini_chat.ipynb
```

## Step 5: Test the connection
Run the cells in order and start chatting!

## Alternative: Use your existing service account
If you want to use your existing Vertex AI setup instead of getting a new API key, let me know and I can modify the notebook to use that.

## What you can do:
- Ask Gemini to research 105 Bailey Ct sale date
- Have it search real estate websites
- Verify property information
- Natural conversation about your real estate analysis

The notebook is set up for natural conversation - just use the `chat("your message")` function!